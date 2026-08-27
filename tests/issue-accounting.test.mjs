import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateIssueTimeLogs,
  buildIssueAccountingIndex,
  buildParentIssueProgress,
  calculateBillingAutoPrice,
  collectSourceTimeLogIds,
  collectReservedInvoiceItemIds,
  collectReservedInvoiceTimeLogIds,
  findInvoiceTimeLogOverlap,
  selectIncrementalBillableIssues,
  sumRawTimeLogMinutes,
} from '../src/lib/utils/issueAccounting.mjs';

test('a parent is indexed with its children without being taken out of the list', () => {
  const issues = [
    { id: 'standalone', projectId: 'p1' },
    { id: 'parent', projectId: 'p1' },
    { id: 'child-a', projectId: 'p1', parentIssueId: 'parent' },
    { id: 'child-b', projectId: 'p1', parentIssueId: 'parent' },
  ];
  const index = buildIssueAccountingIndex(issues);

  assert.deepEqual([...index.summaryIssueIds], ['parent']);
  assert.deepEqual(index.childIdsByParent.get('parent'), ['child-a', 'child-b']);
  // Having children is a fact about the hierarchy, never a reason to drop a
  // task from a report: reports read the issue list itself.
  assert.equal(index.byId.has('parent'), true);
});

test('legacy parentEpicId remains accounting-compatible before migration', () => {
  const issues = [
    { id: 'legacy-parent', projectId: 'p1' },
    { id: 'legacy-child', projectId: 'p1', parentEpicId: 'legacy-parent' },
  ];
  const index = buildIssueAccountingIndex(issues);

  assert.equal(index.parentIdByChild.get('legacy-child'), 'legacy-parent');
});

test('orphan and cross-project parent pointers stay unlinked', () => {
  const issues = [
    { id: 'orphan', projectId: 'p1', parentIssueId: 'missing' },
    { id: 'foreign-parent', projectId: 'p2' },
    { id: 'cross-project-child', projectId: 'p1', parentIssueId: 'foreign-parent' },
  ];
  const index = buildIssueAccountingIndex(issues);

  assert.deepEqual([...index.summaryIssueIds], []);
  assert.deepEqual([...index.orphanIssueIds].sort(), ['cross-project-child', 'orphan']);
});

test('nested legacy hierarchy counts only the deepest leaves and derives parent progress separately', () => {
  const issues = [
    { id: 'root', projectId: 'p1', columnId: 'in-progress' },
    { id: 'middle', projectId: 'p1', parentIssueId: 'root', columnId: 'done' },
    { id: 'done-leaf', projectId: 'p1', parentIssueId: 'middle', columnId: 'done' },
    { id: 'open-leaf', projectId: 'p1', parentIssueId: 'middle', columnId: 'to-do' },
  ];

  const progress = buildParentIssueProgress(issues, ['done']);
  assert.deepEqual(
    progress.map(item => ({
      issueId: item.issueId,
      childIds: item.childIds.sort(),
      done: item.done,
      total: item.total,
      percent: item.percent,
    })),
    [
      {
        issueId: 'root',
        childIds: ['done-leaf', 'open-leaf'],
        done: 1,
        total: 2,
        percent: 50,
      },
      {
        issueId: 'middle',
        childIds: ['done-leaf', 'open-leaf'],
        done: 1,
        total: 2,
        percent: 50,
      },
    ],
  );
});

test('cyclic legacy pointers are ignored so tasks do not vanish from accounting', () => {
  const issues = [
    { id: 'a', projectId: 'p1', parentIssueId: 'b' },
    { id: 'b', projectId: 'p1', parentIssueId: 'a' },
  ];
  const index = buildIssueAccountingIndex(issues);

  assert.deepEqual([...index.summaryIssueIds], []);
  assert.deepEqual([...index.cycleIssueIds].sort(), ['a', 'b']);
});

test('raw time is counted once and task aggregates retain unique source log IDs', () => {
  const logs = [
    { id: 'log-1', issueId: 'task', userId: 'u1', spentMinutes: 30 },
    { id: 'log-1', issueId: 'task', userId: 'u1', spentMinutes: 30 },
    { id: 'log-2', issueId: 'task', userId: 'u2', spentMinutes: 45 },
    {
      id: 'event-log',
      sourceType: 'calendar_event',
      eventId: 'event',
      issueId: 'task',
      spentMinutes: 20,
    },
    { id: 'negative-log', issueId: 'task', userId: 'u1', spentMinutes: -500 },
    { id: 'fractional-log', issueId: 'task', userId: 'u1', spentMinutes: 1.5 },
    { id: 'huge-log', issueId: 'task', userId: 'u1', spentMinutes: 525_601 },
  ];

  assert.equal(sumRawTimeLogMinutes(logs), 95);
  assert.deepEqual(aggregateIssueTimeLogs(logs), {
    task: {
      totalMinutes: 75,
      byUser: { u1: 30, u2: 45 },
      logIds: ['log-1', 'log-2'],
    },
  });
});

test('legacy invoice keys block ambiguous historical work from being billed twice', () => {
  const overlap = findInvoiceTimeLogOverlap(
    [
      { id: 'task-1', issueKey: 'QUI-1' },
      { id: 'task-2', issueKey: 'QUI-2' },
    ],
    {
      'task-1': { totalMinutes: 30, logIds: ['new-log-1'] },
      'task-2': { totalMinutes: 30, logIds: ['new-log-2'] },
    },
    [{
      status: 'draft',
      items: [{ key: 'QUI-1', title: 'Historical task' }],
    }],
  );

  assert.deepEqual(overlap, {
    byItemId: { 'task-1': [] },
    itemIds: ['task-1'],
    logIds: [],
    sourceItemIds: ['task-1'],
  });
});

test('tracked time at a zero rate is worth nothing, and no estimate rescues it', () => {
  const price = calculateBillingAutoPrice({
    logSummary: { totalMinutes: 60, byUser: { u1: 60 } },
    rates: { u1: 0 },
  });

  assert.equal(price, 0);
});

test('an estimate is never money: untracked work prices at zero', () => {
  const price = calculateBillingAutoPrice({
    issue: { estimateMinutes: 120, assigneeIds: ['u1'] },
    logSummary: { totalMinutes: 0, byUser: {} },
    rates: { u1: 50 },
  });

  assert.equal(price, 0);
});

test('a parent bills its own tracked time like any other task', () => {
  const issues = [
    { id: 'parent', projectId: 'p1', estimateMinutes: 600, assigneeIds: ['u1'] },
    { id: 'child', projectId: 'p1', parentIssueId: 'parent', estimateMinutes: 60 },
  ];
  const timeLogs = {
    child: { totalMinutes: 0, byUser: {}, logIds: [] },
    parent: { totalMinutes: 30, byUser: { u1: 30 }, logIds: ['parent-log'] },
  };

  assert.equal(calculateBillingAutoPrice({
    logSummary: timeLogs.parent,
    rates: { u1: 100 },
  }), 50);
  // The 600-minute plan on the parent stays a plan even though its children
  // tracked nothing: only the half hour somebody actually worked is money.
  assert.equal(calculateBillingAutoPrice({
    logSummary: timeLogs.child,
    rates: { u1: 100 },
  }), 0);
  assert.deepEqual(
    collectSourceTimeLogIds(issues, timeLogs),
    ['parent-log'],
  );
});

test('a task reappears after billing only when it receives new unbilled actual time', () => {
  const issues = [
    { id: 'actual-task', projectId: 'p1', estimateMinutes: 120 },
    { id: 'never-billed', projectId: 'p1', estimateMinutes: 60 },
  ];
  const allLogs = {
    'actual-task': {
      totalMinutes: 90,
      byUser: { u1: 90 },
      logIds: ['billed-log', 'new-log'],
    },
  };

  assert.deepEqual(
    selectIncrementalBillableIssues(issues, {}, allLogs).map(issue => issue.id),
    ['never-billed'],
  );
  assert.deepEqual(
    selectIncrementalBillableIssues(issues, {
      'actual-task': {
        totalMinutes: 30,
        byUser: { u1: 30 },
        logIds: ['new-log'],
      },
    }, allLogs).map(issue => issue.id),
    ['actual-task', 'never-billed'],
  );
});

test('saved invoices reserve raw logs and source-less positions', () => {
  const items = [
    { id: 'actual-task' },
    { id: 'manual-task' },
  ];
  const timeLogsByItem = {
    'actual-task': {
      totalMinutes: 30,
      byUser: { u1: 30 },
      logIds: ['log-1', 'log-2'],
    },
    'manual-task': {
      totalMinutes: 0,
      byUser: {},
      logIds: [],
    },
  };
  const invoices = [{
    status: 'draft',
    items: [
      { itemId: 'actual-task', sourceTimeLogIds: ['log-1'] },
      { itemId: 'manual-task', sourceTimeLogIds: [] },
    ],
  }];

  assert.deepEqual(
    [...collectReservedInvoiceTimeLogIds(invoices)],
    ['log-1'],
  );
  assert.deepEqual(
    [...collectReservedInvoiceItemIds(invoices)],
    ['manual-task'],
  );
  assert.deepEqual(
    findInvoiceTimeLogOverlap(items, timeLogsByItem, invoices),
    {
      byItemId: { 'actual-task': ['log-1'], 'manual-task': [] },
      itemIds: ['actual-task', 'manual-task'],
      logIds: ['log-1'],
      sourceItemIds: ['manual-task'],
    },
  );
});

test('cancelled invoices release their source logs for billing again', () => {
  const overlap = findInvoiceTimeLogOverlap(
    [{ id: 'task' }],
    { task: { totalMinutes: 30, byUser: { u1: 30 }, logIds: ['log-1'] } },
    [{ status: 'cancelled', sourceTimeLogIds: ['log-1'] }],
  );

  assert.deepEqual(overlap, {
    byItemId: {},
    itemIds: [],
    logIds: [],
    sourceItemIds: [],
  });
});
