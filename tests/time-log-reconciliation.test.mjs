import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  hasCanonicalIssueTimeScope,
  reconcileIssueSpentMinutes,
  reconciliableTaskTimeLog,
} from '../src/lib/utils/timeLogReconciliation.mjs';

const issue = {
  id: 'issue-1',
  organizationId: 'org-1',
  projectId: 'project-1',
};

test('reconciliation sums only valid task logs in the exact issue scope', () => {
  const result = reconcileIssueSpentMinutes(issue, [
    {
      id: 'task-1',
      issueId: 'issue-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      spentMinutes: 30,
    },
    {
      id: 'task-2',
      issueId: 'issue-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      spentMinutes: 45,
      source: 'youtrack',
    },
    {
      id: 'calendar',
      issueId: 'issue-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      sourceType: 'calendar_event',
      eventId: 'event-1',
      occurrenceStartAt: '2026-07-29T09:00:00.000Z',
      spentMinutes: 60,
    },
    {
      id: 'foreign',
      issueId: 'issue-1',
      organizationId: 'org-1',
      projectId: 'project-2',
      spentMinutes: 120,
    },
  ]);

  assert.equal(result.spentMinutes, 75);
  assert.equal(result.validLogCount, 2);
  assert.deepEqual(result.rejectedLogIds, ['calendar', 'foreign']);
});

test('reconciliation rejects unsafe minute values', () => {
  assert.equal(reconciliableTaskTimeLog({
    issueId: 'issue-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    spentMinutes: 0,
  }, issue), false);
  assert.equal(reconciliableTaskTimeLog({
    issueId: 'issue-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    spentMinutes: 525_601,
  }, issue), false);
  assert.equal(reconciliableTaskTimeLog({
    issueId: 'issue-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    spentMinutes: 1.5,
  }, issue), false);
});

test('reconciliation never certifies a task without an exact org/project scope', () => {
  assert.equal(hasCanonicalIssueTimeScope(issue), true);
  for (const malformedIssue of [
    { ...issue, organizationId: '' },
    { ...issue, projectId: null },
    { organizationId: undefined, projectId: undefined },
  ]) {
    const result = reconcileIssueSpentMinutes(malformedIssue, [{
      id: 'ambiguous',
      spentMinutes: 30,
    }]);
    assert.equal(result.scopeValid, false);
    assert.deepEqual(result.rejectedLogIds, ['ambiguous']);
  }
});

test('Admin reconciliation is dry-run by default and requires exact project confirmation', async () => {
  const script = await readFile(
    new URL('../scripts/reconcile-issue-spent-minutes.mjs', import.meta.url),
    'utf8',
  );
  assert.match(script, /const apply = process\.argv\.includes\('--apply'\)/);
  assert.match(script, /if \(!firebaseProjectId/);
  assert.match(script, /confirmedProjectId !== firebaseProjectId/);
  assert.match(script, /--confirm-writes-frozen/);
  assert.match(script, /db\.runTransaction\(async transaction =>/);
  assert.match(script, /where\('issueId', '==', issueId\)/);
  assert.match(script, /where\('issueId', 'in', issueIdChunk\)/);
  assert.match(script, /logDocumentsById/);
  assert.match(
    script,
    /reconciliation\.rejectedLogIds\.length > 0[\s\S]*status: 'manual-review'/,
  );
  assert.match(script, /log\.sourceType !== 'calendar_event'/);
  assert.match(script, /for \(const issue of issues\)/);
  assert.match(script, /result\.status === 'manual-review'/);
  assert.match(script, /process\.exitCode = 1/);
  assert.doesNotMatch(script, /onAuthStateChanged|signIn|login/i);
});
