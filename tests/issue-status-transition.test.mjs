import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateIssueStatusTransition,
  introducedIssueExecutionViolations,
  issueBlockLinkStatusConflict,
  issueExecutionGraphViolations,
  issueParentStatusConflict,
  MAX_ISSUE_STATUS_ORDER_UPDATES,
  normalizeIssueStatusTransitionInput,
  normalizedIssueBlockEdges,
} from '../src/lib/utils/issueStatusTransition.mjs';

const closedStatusIds = ['done'];

function evaluate(overrides = {}) {
  return evaluateIssueStatusTransition({
    issueId: 'current',
    issue: {
      id: 'current',
      projectId: 'project',
      columnId: 'in-progress',
    },
    nextStatusId: 'done',
    closedStatusIds,
    ...overrides,
  });
}

test('status input accepts a moved issue inside orderUpdates and keeps peers unique', () => {
  assert.deepEqual(normalizeIssueStatusTransitionInput({
    status: ' done ',
    orderUpdates: [
      { issueId: 'peer-a', order: 0 },
      { issueId: 'current', order: 1 },
      { issueId: 'peer-b', order: 2 },
    ],
  }, 'current'), {
    value: {
      status: 'done',
      order: 1,
      orderUpdates: [
        { issueId: 'peer-a', order: 0 },
        { issueId: 'peer-b', order: 2 },
      ],
    },
  });
});

test('status input rejects invalid, duplicate, conflicting and oversized order updates', () => {
  assert.equal(
    normalizeIssueStatusTransitionInput({ status: '' }, 'current').error.code,
    'INVALID_STATUS',
  );
  assert.equal(normalizeIssueStatusTransitionInput({
    status: 'done',
    orderUpdates: null,
  }, 'current').error.code, 'INVALID_ORDER_UPDATES');
  assert.equal(normalizeIssueStatusTransitionInput({
    status: 'done',
    orderUpdates: [{ issueId: 'peer', order: Number.POSITIVE_INFINITY }],
  }, 'current').error.code, 'INVALID_ORDER_UPDATE');
  assert.equal(normalizeIssueStatusTransitionInput({
    status: 'done',
    orderUpdates: [
      { issueId: 'peer', order: 1 },
      { issueId: 'peer', order: 2 },
    ],
  }, 'current').error.code, 'DUPLICATE_ORDER_UPDATE');
  assert.equal(normalizeIssueStatusTransitionInput({
    status: 'done',
    order: 1,
    orderUpdates: [{ issueId: 'current', order: 2 }],
  }, 'current').error.code, 'CONFLICTING_ISSUE_ORDER');
  assert.equal(normalizeIssueStatusTransitionInput({
    status: 'done',
    orderUpdates: Array.from(
      { length: MAX_ISSUE_STATUS_ORDER_UPDATES + 1 },
      (_, index) => ({ issueId: `issue-${index}`, order: index }),
    ),
  }, 'current').error.code, 'TOO_MANY_ORDER_UPDATES');
});

test('an open child cannot be attached to a completed parent', () => {
  assert.equal(issueParentStatusConflict({
    issue: { id: 'child', columnId: 'todo' },
    parentIssue: { id: 'parent', columnId: 'done' },
    closedStatusIds,
  }).code, 'COMPLETED_PARENT_REQUIRES_COMPLETED_CHILD');
  assert.equal(issueParentStatusConflict({
    issue: { id: 'child', columnId: 'done' },
    parentIssue: { id: 'parent', columnId: 'done' },
    closedStatusIds,
  }), null);
  assert.equal(issueParentStatusConflict({
    issue: { id: 'child', columnId: 'todo' },
    parentIssue: { id: 'parent', columnId: 'in-progress' },
    closedStatusIds,
  }), null);
});

test('an open blocker cannot be linked to an already completed target', () => {
  assert.equal(issueBlockLinkStatusConflict({
    sourceIssue: { id: 'blocker', columnId: 'todo' },
    targetIssue: { id: 'target', columnId: 'done' },
    relationType: 'blocks',
    closedStatusIds,
  }).code, 'COMPLETED_TARGET_REQUIRES_COMPLETED_BLOCKER');
  assert.equal(issueBlockLinkStatusConflict({
    sourceIssue: { id: 'blocker', columnId: 'done' },
    targetIssue: { id: 'target', columnId: 'done' },
    relationType: 'blocks',
    closedStatusIds,
  }), null);
  assert.equal(issueBlockLinkStatusConflict({
    sourceIssue: { id: 'source', columnId: 'todo' },
    targetIssue: { id: 'target', columnId: 'done' },
    relationType: 'relates-to',
    closedStatusIds,
  }), null);
});

test('whole-graph validation supports atomic bulk moves and normalized legacy links', () => {
  const issues = [
    { id: 'parent', columnId: 'done' },
    { id: 'child', parentIssueId: 'parent', columnId: 'todo' },
    { id: 'blocker', columnId: 'todo' },
    { id: 'target', columnId: 'done' },
  ];
  const links = [{
    relationType: 'is-blocked-by',
    sourceIssueId: 'target',
    targetIssueId: 'blocker',
  }];
  assert.deepEqual(issueExecutionGraphViolations({
    issues,
    issueLinks: links,
    closedStatusIds,
  }), [
    {
      type: 'completed-target-open-blocker',
      blockerIssueId: 'blocker',
      targetIssueId: 'target',
    },
    {
      type: 'completed-parent-open-child',
      parentIssueId: 'parent',
      childIssueId: 'child',
    },
  ]);

  const allReopened = issues.map(issue => ({ ...issue, columnId: 'todo' }));
  assert.deepEqual(issueExecutionGraphViolations({
    issues: allReopened,
    issueLinks: links,
    closedStatusIds,
  }), []);
});

test('bulk validation distinguishes newly introduced violations from legacy corruption', () => {
  const currentIssues = [
    { id: 'legacy-parent', columnId: 'done' },
    { id: 'legacy-child', parentIssueId: 'legacy-parent', columnId: 'todo' },
    { id: 'new-parent', columnId: 'todo' },
    { id: 'new-child', parentIssueId: 'new-parent', columnId: 'todo' },
  ];
  const nextIssues = currentIssues.map(issue => (
    issue.id === 'new-parent' ? { ...issue, columnId: 'done' } : issue
  ));
  assert.deepEqual(introducedIssueExecutionViolations({
    currentIssues,
    nextIssues,
    currentClosedStatusIds: closedStatusIds,
    nextClosedStatusIds: closedStatusIds,
  }), [{
    type: 'completed-parent-open-child',
    parentIssueId: 'new-parent',
    childIssueId: 'new-child',
  }]);
});

test('canonical and legacy inverse blocker documents collapse to directional edges', () => {
  assert.deepEqual(normalizedIssueBlockEdges([
    {
      relationType: 'blocks',
      sourceIssueId: 'blocker',
      targetIssueId: 'target',
    },
    {
      relationType: 'is-blocked-by',
      sourceIssueId: 'target',
      targetIssueId: 'blocker',
    },
    {
      relationType: 'relates-to',
      sourceIssueId: 'target',
      targetIssueId: 'other',
    },
  ]), [{
    sourceIssueId: 'blocker',
    targetIssueId: 'target',
  }]);
});

test('entering a terminal status reports open real children and blockers together', () => {
  const transition = evaluate({
    childIssues: [
      {
        id: 'open-child',
        parentIssueId: 'current',
        columnId: 'todo',
      },
      {
        id: 'done-child',
        parentIssueId: 'current',
        columnId: 'done',
      },
      {
        id: 'stale-legacy-child',
        parentIssueId: 'someone-else',
        parentEpicId: 'current',
        columnId: 'todo',
      },
    ],
    issueLinks: [
      {
        relationType: 'blocks',
        sourceIssueId: 'open-blocker',
        targetIssueId: 'current',
      },
      {
        relationType: 'is-blocked-by',
        sourceIssueId: 'current',
        targetIssueId: 'open-blocker',
      },
      {
        relationType: 'blocks',
        sourceIssueId: 'done-blocker',
        targetIssueId: 'current',
      },
    ],
    relatedIssues: [
      { id: 'open-blocker', columnId: 'in-progress' },
      { id: 'done-blocker', columnId: 'done' },
    ],
  });

  assert.equal(transition.error.code, 'ISSUE_COMPLETION_BLOCKED');
  assert.deepEqual(transition.error.openChildIssueIds, ['open-child']);
  assert.deepEqual(transition.error.openBlockerIssueIds, ['open-blocker']);
});

test('dangling and deleting dependencies do not permanently block completion', () => {
  const transition = evaluate({
    childIssues: [{
      id: 'deleting-child',
      parentIssueId: 'current',
      columnId: 'todo',
      deletionPending: true,
    }],
    issueLinks: [
      {
        relationType: 'blocks',
        sourceIssueId: 'missing',
        targetIssueId: 'current',
      },
      {
        relationType: 'blocks',
        sourceIssueId: 'deleting-blocker',
        targetIssueId: 'current',
      },
    ],
    relatedIssues: [{
      id: 'deleting-blocker',
      columnId: 'todo',
      deletionPending: true,
    }],
  });
  assert.equal(transition.error, null);
  assert.equal(transition.enteringTerminal, true);
});

test('a completed parent prevents reopening its child', () => {
  const transition = evaluate({
    issue: {
      id: 'current',
      parentIssueId: 'parent',
      columnId: 'done',
    },
    nextStatusId: 'in-progress',
    parentIssue: {
      id: 'parent',
      columnId: 'done',
    },
  });
  assert.equal(transition.error.code, 'ISSUE_REOPEN_BLOCKED');
  assert.equal(transition.error.completedParentIssueId, 'parent');
});

test('a completed blocked target prevents reopening its blocker in either storage direction', () => {
  const transition = evaluate({
    issue: {
      id: 'current',
      columnId: 'done',
    },
    nextStatusId: 'todo',
    issueLinks: [{
      relationType: 'is-blocked-by',
      sourceIssueId: 'completed-target',
      targetIssueId: 'current',
    }],
    relatedIssues: [{
      id: 'completed-target',
      columnId: 'done',
    }],
  });
  assert.equal(transition.error.code, 'ISSUE_REOPEN_BLOCKED');
  assert.deepEqual(
    transition.error.completedBlockedTargetIssueIds,
    ['completed-target'],
  );
});

test('non-terminal moves and terminal-to-terminal moves need no dependency gate', () => {
  const links = [{
    relationType: 'blocks',
    sourceIssueId: 'blocker',
    targetIssueId: 'current',
  }];
  const relatedIssues = [{ id: 'blocker', columnId: 'todo' }];
  assert.equal(evaluate({
    nextStatusId: 'todo',
    issueLinks: links,
    relatedIssues,
  }).error, null);
  assert.equal(evaluate({
    issue: { id: 'current', columnId: 'done' },
    nextStatusId: 'released',
    closedStatusIds: ['done', 'released'],
    issueLinks: links,
    relatedIssues,
  }).error, null);
});
