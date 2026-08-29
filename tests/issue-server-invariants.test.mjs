import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('issue deletion blocks both billed logs and source-less estimate reservations', async () => {
  const route = await read('../src/app/api/issues/[issueId]/route.js');
  const reservationRead = route.indexOf('transaction.get(estimateReservationRef)');
  const tombstoneWrite = route.indexOf('transaction.create(tombstoneRef');

  assert.ok(reservationRead > 0 && reservationRead < tombstoneWrite);
  assert.match(route, /invoiceSourcelessReservationId\(/);
  assert.match(route, /ISSUE_HAS_INVOICE_ESTIMATE/);
  assert.match(route, /ISSUE_HAS_BILLED_TIME/);
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

test('actual task time cannot race a source-less estimate invoice reservation', async () => {
  const [postRoute, itemRoute, taskTimeModel] = await Promise.all([
    read('../src/app/api/issues/[issueId]/time-logs/route.js'),
    read('../src/app/api/issues/[issueId]/time-logs/[logId]/route.js'),
    read('../src/lib/utils/taskTimeLog.mjs'),
  ]);
  const reservationRef = postRoute.indexOf(
    "collection('invoiceEstimateReservations').doc(",
  );
  const deterministicId = postRoute.indexOf(
    'invoiceSourcelessReservationId(organizationId, projectId, issueId)',
  );
  const transactionStart = postRoute.indexOf(
    'await db.runTransaction(async transaction =>',
  );
  const reservationRead = postRoute.search(/transaction\.get\(\s*estimateReservationRef,/);
  const logWrite = postRoute.indexOf(
    'transaction.create(logRef,',
    transactionStart,
  );

  assert.ok(reservationRef > 0 && reservationRef < transactionStart);
  assert.ok(deterministicId > reservationRef && deterministicId < transactionStart);
  assert.ok(reservationRead > transactionStart && reservationRead < logWrite);
  assert.match(
    taskTimeModel,
    /reservation\.organizationId[\s\S]*?reservation\.projectId[\s\S]*?reservation\.itemId/,
  );
  assert.match(postRoute, /TASK_TIME_ESTIMATE_ALREADY_INVOICED/);
  assert.doesNotMatch(itemRoute, /invoiceEstimateReservations/);
  assert.doesNotMatch(itemRoute, /TASK_TIME_ESTIMATE_ALREADY_INVOICED/);
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

test('issue creation validates the canonical organization-wide sprint model', async () => {
  const route = await read('../src/app/api/issues/route.js');

  assert.match(
    route,
    /sprintSnap\.data\(\)\.organizationId !== organizationId/g,
  );
  assert.match(route, /sprintSnap\.data\(\)\.status === 'completed'/g);
  assert.doesNotMatch(route, /sprintSnap\.data\(\)\.projectId !== projectId/);
});
