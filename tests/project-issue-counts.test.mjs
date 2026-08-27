import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  PROJECT_ISSUE_COUNTS_FIELD,
  PROJECT_ISSUE_COUNTS_VERSION,
  ProjectIssueCountDeltas,
  countingDay,
  deliveredPercent,
  isCountedIssue,
  issueCountContribution,
  projectIssueCounts,
  projectIssueCountsMatch,
  rebuildProjectIssueCounts,
} from '../src/lib/utils/projectIssueCounts.mjs';

// What a project card costs to draw.
//
// The home screen used to compute a progress bar per project by reading every
// task of every project the account could open — the widest read in the
// product, on the screen people come back to most. These counters replace that
// with one document per project, which is only worth anything if the numbers on
// it are the same numbers the tasks would have produced.
//
// So the tests here are mostly one assertion said twice: a sequence of deltas
// and a rebuild from scratch must land on the same three figures. That is the
// property the whole design rests on, and it is the one a bug in any single
// mutation path breaks.

const TIME_ZONE = 'Europe/Kyiv';
const DAY = '2026-08-27';
const CONTEXT = {
  deliveredStatusIds: ['done'],
  closedStatusIds: ['done'],
  countedDay: DAY,
  timeZone: TIME_ZONE,
};

/** A deadline that falls on the given day in the organization's timezone. */
function dueOn(dayKey) {
  return new Date(`${dayKey}T20:59:59.999Z`);
}

function issue(overrides = {}) {
  return {
    id: 'i1',
    projectId: 'p1',
    organizationId: 'org',
    columnId: 'todo',
    status: 'todo',
    dueDate: null,
    ...overrides,
  };
}

function deltas() {
  const accumulator = new ProjectIssueCountDeltas({
    deliveredStatusIds: CONTEXT.deliveredStatusIds,
    closedStatusIds: CONTEXT.closedStatusIds,
    timeZone: TIME_ZONE,
  });
  accumulator.observeProject('p1', {
    [PROJECT_ISSUE_COUNTS_FIELD]: { countedDay: DAY },
  });
  accumulator.observeProject('p2', {
    [PROJECT_ISSUE_COUNTS_FIELD]: { countedDay: DAY },
  });
  return accumulator;
}

/** The deltas applied on top of a starting total, as a plain object. */
function applied(start, accumulator, projectId = 'p1') {
  const entry = accumulator.changed().find(candidate => candidate.projectId === projectId)
    || { total: 0, delivered: 0, overdue: 0 };
  return {
    total: start.total + entry.total,
    delivered: start.delivered + entry.delivered,
    overdue: start.overdue + entry.overdue,
  };
}

test('the counted set is the working set — not archived, not cancelled, not being deleted', () => {
  assert.equal(isCountedIssue(issue()), true);
  assert.equal(isCountedIssue(issue({ archivedAt: new Date() })), false);
  assert.equal(isCountedIssue(issue({ cancelledAt: new Date() })), false);
  assert.equal(isCountedIssue(issue({ deletionPending: true })), false);
  // A task with no project has no counter to belong to.
  assert.equal(isCountedIssue(issue({ projectId: '' })), false);

  for (const put of ['archivedAt', 'cancelledAt']) {
    assert.deepEqual(
      issueCountContribution(issue({ [put]: new Date() }), CONTEXT),
      { total: 0, delivered: 0, overdue: 0 },
    );
  }
});

test('delivered is the narrower reading, overdue is the wider one', () => {
  const context = {
    ...CONTEXT,
    deliveredStatusIds: ['done'],
    // A workflow where «На перевірці» also closes a task: it is closed, so it
    // cannot be late — but it has not been delivered either.
    closedStatusIds: ['done', 'review'],
  };
  assert.deepEqual(
    issueCountContribution(issue({ columnId: 'review', dueDate: dueOn('2026-08-01') }), context),
    { total: 1, delivered: 0, overdue: 0 },
  );
  assert.deepEqual(
    issueCountContribution(issue({ columnId: 'done' }), context),
    { total: 1, delivered: 1, overdue: 0 },
  );
  assert.deepEqual(
    issueCountContribution(issue({ columnId: 'in-progress', dueDate: dueOn('2026-08-01') }), context),
    { total: 1, delivered: 0, overdue: 1 },
  );
});

test('a deadline is late against the counted day, never against the wall clock', () => {
  // Due yesterday relative to the counted day: late.
  assert.equal(
    issueCountContribution(issue({ dueDate: dueOn('2026-08-26') }), CONTEXT).overdue,
    1,
  );
  // Due on the counted day itself: not late. A deadline is a day, and the day
  // is not over.
  assert.equal(
    issueCountContribution(issue({ dueDate: dueOn(DAY) }), CONTEXT).overdue,
    0,
  );
  // Due tomorrow: not late.
  assert.equal(
    issueCountContribution(issue({ dueDate: dueOn('2026-08-28') }), CONTEXT).overdue,
    0,
  );
});

test('a task that slipped since the last count moves the counter by nothing', () => {
  // The stored figures answer for the 27th. A task due on the 27th was not late
  // then, so it was never in `overdue` — and delivering it on the 28th, before
  // the recount has run, must not take away a task the total never counted.
  const before = issue({ columnId: 'in-progress', dueDate: dueOn(DAY) });
  const accumulator = deltas();
  accumulator.change(before, { ...before, columnId: 'done', status: 'done' });
  assert.deepEqual(
    accumulator.changed(),
    [{ projectId: 'p1', total: 0, delivered: 1, overdue: 0 }],
  );

  // Evaluated against today instead, the same edit would have said -1 and left
  // the counter below the number of tasks that are actually late.
  const naive = new ProjectIssueCountDeltas({
    deliveredStatusIds: CONTEXT.deliveredStatusIds,
    closedStatusIds: CONTEXT.closedStatusIds,
    timeZone: TIME_ZONE,
  });
  naive.observeProject('p1', {
    [PROJECT_ISSUE_COUNTS_FIELD]: { countedDay: '2026-08-28' },
  });
  naive.change(before, { ...before, columnId: 'done', status: 'done' });
  assert.deepEqual(
    naive.changed(),
    [{ projectId: 'p1', total: 0, delivered: 1, overdue: -1 }],
  );
});

test('deltas and a rebuild agree over a sequence of mutations', () => {
  const start = [
    issue({ id: 'a', columnId: 'todo', dueDate: dueOn('2026-08-20') }),
    issue({ id: 'b', columnId: 'in-progress' }),
    issue({ id: 'c', columnId: 'done' }),
    issue({ id: 'd', columnId: 'todo', archivedAt: new Date() }),
  ];
  const startTotals = rebuildProjectIssueCounts(start, { ...CONTEXT, projectIds: ['p1'] }).get('p1');
  assert.deepEqual(startTotals, { total: 3, delivered: 1, overdue: 1 });

  // Everything a task can have done to it, applied both ways.
  const mutations = [
    // created
    [null, issue({ id: 'e', columnId: 'todo', dueDate: dueOn('2026-08-10') })],
    // status moved to delivered, which also stops it being late
    [start[0], { ...start[0], columnId: 'done', status: 'done' }],
    // archived
    [start[1], { ...start[1], archivedAt: new Date() }],
    // un-archived
    [start[3], { ...start[3], archivedAt: null }],
    // cancelled
    [start[2], { ...start[2], cancelledAt: new Date() }],
    // deleted
    [issue({ id: 'f' }), null],
  ];
  const accumulator = deltas();
  // `f` has to exist before it can be deleted, so it is created first.
  accumulator.change(null, issue({ id: 'f' }));
  for (const [before, after] of mutations) accumulator.change(before, after);

  const end = [
    { ...start[0], columnId: 'done', status: 'done' },
    { ...start[1], archivedAt: new Date() },
    { ...start[2], cancelledAt: new Date() },
    { ...start[3], archivedAt: null },
    issue({ id: 'e', columnId: 'todo', dueDate: dueOn('2026-08-10') }),
  ];
  const endTotals = rebuildProjectIssueCounts(end, { ...CONTEXT, projectIds: ['p1'] }).get('p1');
  assert.deepEqual(applied(startTotals, accumulator), endTotals);
});

test('a task moved between projects leaves both counters right', () => {
  const before = issue({ id: 'a', projectId: 'p1', columnId: 'done' });
  const after = { ...before, projectId: 'p2' };
  const accumulator = deltas();
  accumulator.change(before, after);
  assert.deepEqual(accumulator.changed().sort((x, y) => x.projectId.localeCompare(y.projectId)), [
    { projectId: 'p1', total: -1, delivered: -1, overdue: 0 },
    { projectId: 'p2', total: 1, delivered: 1, overdue: 0 },
  ]);
});

test('a retried transaction is reset rather than counted twice', () => {
  const accumulator = deltas();
  accumulator.change(null, issue({ id: 'a' }));
  accumulator.reset();
  accumulator.change(null, issue({ id: 'a' }));
  assert.deepEqual(accumulator.changed(), [{ projectId: 'p1', total: 1, delivered: 0, overdue: 0 }]);
});

test('a zero delta is not a write', () => {
  const accumulator = deltas();
  const unchanged = issue({ id: 'a', columnId: 'todo' });
  // A label or an assignee changed. Nothing a counter looks at did.
  accumulator.change(unchanged, { ...unchanged, labelIds: ['x'] });
  assert.deepEqual(accumulator.changed(), []);
});

test('a project with no tasks is reported as three zeroes, not as nothing', () => {
  const totals = rebuildProjectIssueCounts([], { ...CONTEXT, projectIds: ['p1', 'p2'] });
  assert.deepEqual(totals.get('p1'), { total: 0, delivered: 0, overdue: 0 });
  assert.deepEqual(totals.get('p2'), { total: 0, delivered: 0, overdue: 0 });
});

test('counters no full count has established are not readable', () => {
  const established = {
    version: PROJECT_ISSUE_COUNTS_VERSION,
    total: 4,
    delivered: 2,
    overdue: 1,
    countedDay: DAY,
    countedAt: new Date(),
  };
  assert.deepEqual(
    projectIssueCounts({ [PROJECT_ISSUE_COUNTS_FIELD]: established }),
    { total: 4, delivered: 2, overdue: 1, countedDay: DAY, countedAt: established.countedAt },
  );

  // A block increments alone have written carries no `countedAt`, so a reader
  // falls back to the tasks rather than drawing a bar out of a number that
  // started from something nobody counted.
  assert.equal(
    projectIssueCounts({ [PROJECT_ISSUE_COUNTS_FIELD]: { total: 4, delivered: 2, overdue: 1 } }),
    null,
  );
  assert.equal(
    projectIssueCounts({
      [PROJECT_ISSUE_COUNTS_FIELD]: { ...established, version: PROJECT_ISSUE_COUNTS_VERSION + 1 },
    }),
    null,
  );
  assert.equal(projectIssueCounts({}), null);
  assert.equal(projectIssueCounts(null), null);
});

test('a recount that would write the same numbers writes nothing', () => {
  const computed = { total: 3, delivered: 1, overdue: 1 };
  const stored = { version: PROJECT_ISSUE_COUNTS_VERSION, ...computed, countedDay: DAY };
  assert.equal(projectIssueCountsMatch(stored, computed, DAY), true);
  // The same numbers on a different day are a different answer: `overdue` is
  // only ever true as of the day it was asked about.
  assert.equal(projectIssueCountsMatch(stored, computed, '2026-08-28'), false);
  assert.equal(projectIssueCountsMatch(stored, { ...computed, delivered: 2 }, DAY), false);
  assert.equal(projectIssueCountsMatch(null, computed, DAY), false);
});

test('the day a count answers for is the workspace\'s own, not the reader\'s', () => {
  // 22:30 in Kyiv on the 27th is already the 28th in Auckland and still the
  // 27th in London. The workspace decides.
  const evening = Date.parse('2026-08-27T19:30:00.000Z');
  assert.equal(countingDay(evening, 'Europe/Kyiv'), '2026-08-27');
  assert.equal(countingDay(evening, 'Pacific/Auckland'), '2026-08-28');
});

test('the percentage a card draws is the same arithmetic either way', () => {
  assert.equal(deliveredPercent({ total: 4, delivered: 1 }), 25);
  assert.equal(deliveredPercent({ total: 0, delivered: 0 }), 0);
  assert.equal(deliveredPercent(null), 0);
});

// ── The mutation paths ───────────────────────────────────────────────────
//
// A counter is only as good as the completeness of the list of things that
// maintain it. This is that list, and it fails when something starts writing
// tasks without saying so — which is the failure that turns a cheap number into
// a wrong one, silently, on the screen that stopped reading the tasks behind it.

const COUNTING_PATHS = [
  ['src/app/api/issues/route.js', 'creating a task'],
  ['src/app/api/issues/bulk/route.js', 'a bulk deadline'],
  ['src/app/api/issues/[issueId]/status/route.js', 'moving a task'],
  ['src/app/api/issues/[issueId]/archive/route.js', 'archiving a task'],
  ['src/app/api/issues/[issueId]/cancel/route.js', 'cancelling a task'],
  ['src/app/api/issues/[issueId]/restore/route.js', 'restoring a deleted task'],
  ['src/app/api/issues/[issueId]/route.js', 'deleting a task'],
  ['src/app/api/v1/tasks/route.js', 'a task from the public API'],
  ['src/lib/server/telegram.js', 'a task dictated into Telegram'],
];

// Two paths change what every counter in a workspace means rather than moving
// one of them, so they rebuild instead of incrementing.
const REBUILDING_PATHS = [
  ['src/app/api/organizations/[organizationId]/workflow/route.js', 'the workflow itself changed'],
  ['src/lib/server/youtrackImporter.js', 'an import wrote tasks one at a time'],
  ['src/lib/server/reminderJobs.js', 'the twice-daily pass'],
];

test('every path that writes a task maintains the project counters', async () => {
  for (const [path, why] of COUNTING_PATHS) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(
      source,
      /projectIssueCountDeltasFor/,
      `${path} writes tasks (${why}) and must keep the project counters`,
    );
    assert.match(
      source,
      /projectIssueCountIncrements|writeProjectIssueCountDeltas/,
      `${path} accumulates counter deltas (${why}) but never writes them`,
    );
  }
});

test('what cannot be a delta is rebuilt instead', async () => {
  for (const [path, why] of REBUILDING_PATHS) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(
      source,
      /recountProjectIssueCounts/,
      `${path} needs a full rebuild (${why})`,
    );
  }
});

test('the recount rides the pass that already runs twice a day', async () => {
  const [sweep, workflow] = await Promise.all([
    readFile(new URL('../src/lib/server/reminderJobs.js', import.meta.url), 'utf8'),
    readFile(new URL('../.github/workflows/scheduled-notifications.yml', import.meta.url), 'utf8'),
  ]);
  // Gated on the materialise pass actually being due, so a manual run does not
  // make a second full pass over every task within the same twelve hours.
  assert.match(sweep, /wantsMaterialise && materialiseDue\s*\?\s*await recountProjectIssueCounts/);
  // And that pass is the one that runs twice, twelve hours apart — which is the
  // whole reason `overdue` can be true in the morning of any timezone.
  assert.match(workflow, /- cron: '11 3 \* \* \*'/);
  assert.match(workflow, /- cron: '11 15 \* \* \*'/);
});

test('a browser cannot write the counters it is about to be shown', async () => {
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const projectUpdate = rules.slice(rules.indexOf('match /projects/{projectId}'));
  assert.match(projectUpdate.slice(0, 2_000), /'issueCounts'/);
});
