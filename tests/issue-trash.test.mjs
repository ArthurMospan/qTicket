import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUE_UNDO_RETENTION_MS,
  canRestoreIssueTombstone,
  issueTombstoneId,
  issueUndoExpiresAt,
} from '../src/lib/utils/issueTrash.mjs';

test('issue tombstones are deterministic and organization-scoped', () => {
  assert.equal(issueTombstoneId('org-a', 'issue-a'), 'org-a_issue-a');
  assert.equal(issueTombstoneId('', 'issue-a'), '');
});

test('issue undo retention is one day', () => {
  assert.equal(issueUndoExpiresAt(100), 100 + ISSUE_UNDO_RETENTION_MS);
  assert.equal(issueUndoExpiresAt('invalid'), 0);
});

test('only an intact, unexpired and unclaimed tombstone can be restored', () => {
  const tombstone = { issue: { id: 'issue-a' }, purgeAfter: { toMillis: () => 200 } };
  assert.equal(canRestoreIssueTombstone(tombstone, 100), true);
  assert.equal(canRestoreIssueTombstone(tombstone, 200), false);
  assert.equal(canRestoreIssueTombstone({ ...tombstone, purgingAt: new Date() }, 100), false);
  assert.equal(canRestoreIssueTombstone({ purgeAfter: { toMillis: () => 200 } }, 100), false);
});
