import test from 'node:test';
import assert from 'node:assert/strict';

import {
  existingParentIssueId,
  findCanonicalIssueParentCycles,
  legacySubtasksToChecklist,
  normalizeParentIssueId,
  validateIssueParentAssignment,
} from '../src/lib/utils/issueHierarchyModel.mjs';

test('canonical hierarchy cycle detection reports each cycle once and ignores legacy pointers', () => {
  assert.deepEqual(findCanonicalIssueParentCycles([
    { id: 'a', parentIssueId: 'b' },
    { id: 'b', parentIssueId: 'c' },
    { id: 'c', parentIssueId: 'a' },
    { id: 'self', parentIssueId: 'self' },
    { id: 'legacy-a', parentEpicId: 'legacy-b' },
    { id: 'legacy-b', parentEpicId: 'legacy-a' },
    { id: 'tail', parentIssueId: 'a' },
  ]), [
    ['a', 'b', 'c', 'a'],
    ['self', 'self'],
  ]);
});

const topLevel = {
  organizationId: 'org-a',
  projectId: 'project-a',
  parentIssueId: null,
};

test('parent ids normalize nulls but reject non-string and oversized values', () => {
  assert.equal(normalizeParentIssueId(null), null);
  assert.equal(normalizeParentIssueId('  issue-a '), 'issue-a');
  assert.equal(normalizeParentIssueId(123), undefined);
  assert.equal(normalizeParentIssueId('x'.repeat(257)), undefined);
});

test('legacy parentEpicId remains visible to hierarchy validation', () => {
  assert.equal(existingParentIssueId({ parentEpicId: 'legacy-parent' }), 'legacy-parent');
  assert.equal(existingParentIssueId({ parentIssueId: 'new-parent', parentEpicId: 'legacy-parent' }), 'new-parent');
  assert.equal(existingParentIssueId({ parentIssueId: null, parentEpicId: 'stale-parent' }), null);
});

test('one-level hierarchy accepts a same-project top-level parent', () => {
  assert.equal(validateIssueParentAssignment({
    issueId: 'child',
    issue: topLevel,
    requestedParentIssueId: 'parent',
    parent: topLevel,
    childIds: [],
  }), null);
});

test('one-level hierarchy rejects self, cross-project, nested parent and parent-with-children', () => {
  assert.equal(validateIssueParentAssignment({
    issueId: 'issue-a',
    issue: topLevel,
    requestedParentIssueId: 'issue-a',
    parent: topLevel,
  }).code, 'SELF_PARENT');

  assert.equal(validateIssueParentAssignment({
    issueId: 'issue-a',
    issue: topLevel,
    requestedParentIssueId: 'parent',
    parent: { ...topLevel, projectId: 'project-b' },
  }).code, 'PARENT_SCOPE_MISMATCH');

  assert.equal(validateIssueParentAssignment({
    issueId: 'issue-a',
    issue: topLevel,
    requestedParentIssueId: 'parent',
    parent: { ...topLevel, parentIssueId: 'grandparent' },
  }).code, 'PARENT_IS_CHILD');

  assert.deepEqual(validateIssueParentAssignment({
    issueId: 'issue-a',
    issue: topLevel,
    requestedParentIssueId: 'parent',
    parent: topLevel,
    childIds: ['child-a', 'child-b', 'child-a'],
  }), {
    code: 'ISSUE_HAS_CHILDREN',
    status: 409,
    message: 'Завдання з підзавданнями не можна зробити підзавданням',
    childCount: 2,
  });
});

test('detaching an issue does not require a parent document', () => {
  assert.equal(validateIssueParentAssignment({
    issueId: 'child',
    issue: { ...topLevel, parentIssueId: 'parent' },
    requestedParentIssueId: null,
    parent: null,
    childIds: [],
  }), null);
});

test('legacy checklist migration is idempotent and preserves completion', () => {
  const migrated = legacySubtasksToChecklist('Опис', [
    { title: '  Перший   крок ', done: true },
    { title: 'Другий\nкрок', done: false },
    { title: '', done: false },
  ]);
  assert.match(migrated, /^Опис\n\n<!-- quickteam:legacy-subtasks-migrated -->/u);
  assert.match(migrated, /- \[x\] Перший крок/u);
  assert.match(migrated, /- \[ \] Другий крок/u);
  assert.equal(legacySubtasksToChecklist(migrated, [{ title: 'Ще раз' }]), migrated);
});
