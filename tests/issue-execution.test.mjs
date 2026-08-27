import test from 'node:test';
import assert from 'node:assert/strict';

import {
  issueCompletionBlockers,
  openBlockerIssues,
  openChildIssues,
} from '../src/lib/utils/issueExecution.mjs';

const issues = [
  { id: 'parent', projectId: 'p', columnId: 'in-progress' },
  { id: 'open-child', projectId: 'p', parentIssueId: 'parent', columnId: 'todo' },
  { id: 'done-child', projectId: 'p', parentIssueId: 'parent', columnId: 'done' },
  { id: 'blocker', projectId: 'p', columnId: 'in-progress' },
  { id: 'done-blocker', projectId: 'p', columnId: 'done' },
  { id: 'target', projectId: 'p', columnId: 'in-progress' },
];

test('only unfinished real child issues block parent completion', () => {
  assert.deepEqual(
    openChildIssues('parent', issues, ['done']).map(issue => issue.id),
    ['open-child'],
  );
});

test('canonical and partial legacy dependency records resolve without duplicates', () => {
  const links = [
    {
      id: 'canonical',
      relationType: 'blocks',
      sourceIssueId: 'blocker',
      targetIssueId: 'target',
    },
    {
      id: 'legacy-inverse',
      relationType: 'is-blocked-by',
      sourceIssueId: 'target',
      targetIssueId: 'blocker',
    },
    {
      id: 'already-done',
      relationType: 'blocks',
      sourceIssueId: 'done-blocker',
      targetIssueId: 'target',
    },
  ];

  assert.deepEqual(
    openBlockerIssues('target', issues, links, ['done']).map(issue => issue.id),
    ['blocker'],
  );
});

test('dangling links do not make completion permanently impossible', () => {
  assert.deepEqual(openBlockerIssues('target', issues, [{
    relationType: 'blocks',
    sourceIssueId: 'deleted',
    targetIssueId: 'target',
  }], ['done']), []);
});

test('completion reports children and dependencies independently', () => {
  const result = issueCompletionBlockers({
    issueId: 'parent',
    issues,
    issueLinks: [{
      relationType: 'blocks',
      sourceIssueId: 'blocker',
      targetIssueId: 'parent',
    }],
    closedStatusIds: ['done'],
  });
  assert.equal(result.canComplete, false);
  assert.deepEqual(result.children.map(issue => issue.id), ['open-child']);
  assert.deepEqual(result.dependencies.map(issue => issue.id), ['blocker']);
});
