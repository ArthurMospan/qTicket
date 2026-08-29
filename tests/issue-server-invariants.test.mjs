import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('YouTrack issue updates share workflow, hierarchy and deletion invariants', async () => {
  const importer = await read('../src/lib/server/youtrackImporter.js');

  assert.match(importer, /transaction\.get\(workflowRef\)/);
  assert.match(importer, /evaluateIssueStatusTransition\(\{/);
  assert.match(importer, /currentIssue\.deletionPending === true/);
  assert.match(importer, /freshSource\.data\(\)\.deletionPending === true/);
  assert.match(importer, /freshTarget\.data\(\)\.deletionPending === true/);
  assert.match(importer, /issueBlockLinkStatusConflict\(\{/);
  assert.match(importer, /issueStatusVersion:\s*FieldValue\.increment\(1\)/);
});

test('reciprocal YouTrack links can upgrade one pending pair deterministically', async () => {
  const importer = await read('../src/lib/server/youtrackImporter.js');

  assert.match(importer, /strongestYouTrackRelationRow\(rowsById\.get\(row\.id\), row\)/);
  assert.match(importer, /strongestYouTrackRelationRow\(snapshot\.data\(\), row\)/);
  assert.match(importer, /snapshot\.data\(\)\.status !== 'pending'/);
  assert.match(importer, /transaction\.update\(snapshot\.ref,\s*\{/);
});

test('issue deletion is reversible until the retention purge', async () => {
  const [removeRoute, restoreRoute, trashServer, detail] = await Promise.all([
    read('../src/app/api/issues/[issueId]/route.js'),
    read('../src/app/api/issues/[issueId]/restore/route.js'),
    read('../src/lib/server/issueTrash.js'),
    read('../src/components/workspace/IssueDetail.jsx'),
  ]);
  assert.match(removeRoute, /transaction\.create\(tombstoneRef/);
  assert.match(removeRoute, /transaction\.delete\(issueRef\)/);
  assert.doesNotMatch(removeRoute, /recursiveDelete\(issueRef\)/);
  assert.match(restoreRoute, /canRestoreIssueTombstone/);
  assert.match(restoreRoute, /transaction\.create\(issueRef/);
  assert.match(restoreRoute, /transaction\.delete\(tombstoneRef\)/);
  assert.match(trashServer, /purgeExpiredDeletedIssues/);
  assert.match(trashServer, /recursiveDelete\(issueRef\)/);
  assert.match(detail, /label: 'Скасувати'/);
  assert.match(detail, /duration: 30000/);
  assert.match(detail, /restoreIssue\(issueId, deletion\.organizationId\)/);
});

test('hierarchy migration revalidates exact link inputs and live endpoints on apply', async () => {
  const migration = await read('../scripts/migrate-issue-hierarchy-v2.mjs');
  const fingerprintCheck = migration.indexOf('linkDocumentFingerprint(current.data())');
  const canonicalWrite = migration.indexOf('transaction.set(canonicalRef');

  assert.ok(fingerprintCheck > 0 && fingerprintCheck < canonicalWrite);
  assert.match(migration, /expectedLegacy:\s*documents\.map/);
  assert.match(migration, /sourceIssue\.data\(\)\.deletionPending === true/);
  assert.match(migration, /targetIssue\.data\(\)\.deletionPending === true/);
  assert.match(migration, /canonical-created-during-apply/);
  assert.match(migration, /link-pair-membership-changed/);
  assert.match(migration, /isCleanCanonicalLink\(documents\[0\]/);
  assert.match(migration, /malformed-legacy-parent-id/);
  assert.match(migration, /migration-marker-with-live-subtasks/);
  assert.match(migration, /invalidSubtaskIndexes/);
  assert.match(
    migration,
    /db\.runTransaction\(async transaction =>[\s\S]*?transaction\.get\(workflowRef\)/,
  );
});

test('external task creators resolve the fresh workflow in their create transaction', async () => {
  const [v1Route, telegram] = await Promise.all([
    read('../src/app/api/v1/tasks/route.js'),
    read('../src/lib/server/telegram.js'),
  ]);

  for (const source of [v1Route, telegram]) {
    const transactionStart = source.indexOf('runTransaction(async transaction =>');
    const workflowRead = source.indexOf('transaction.get(workflowRef)', transactionStart);
    const issueCreate = source.indexOf('transaction.create(issueRef', transactionStart);

    assert.ok(transactionStart > 0 && workflowRead > transactionStart);
    assert.ok(workflowRead < issueCreate);
    assert.match(source, /hiddenColumns/);
    assert.match(source, /resolveClosedStatusIds/);
  }
});

test('status API error details can never replace the HTTP status code', async () => {
  const route = await read('../src/app/api/issues/[issueId]/status/route.js');

  // A detail named `status` used to overwrite the numeric 409 with a status id.
  // `NextResponse.json` then threw inside the catch block, so the browser only
  // ever saw the generic client fallback instead of the real reason.
  assert.match(route, /error\.api = \{ \.\.\.details, code, status, message \}/);
  assert.match(route, /NextResponse\.json\(\{\s*\.\.\.details,\s*error,/);
  assert.doesNotMatch(route, /\{ status: requestedStatus \}/);
  assert.match(route, /\{ statusId: requestedStatus \}/);
});
