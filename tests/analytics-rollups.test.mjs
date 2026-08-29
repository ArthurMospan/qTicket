import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ANALYTICS_ROLLUP_VERSION,
  AnalyticsRollupDeltas,
  analyticsRollupDay,
  analyticsRollupId,
  countedMinutesByUser,
  countedTaskMinutes,
  rebuildRollupTotals,
  rollupTotalsMatch,
  summarizeRawTimeLogs,
  summarizeRollups,
} from '../src/lib/utils/analyticsRollups.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const KYIV = 'Europe/Kyiv';

function taskLog(overrides = {}) {
  return {
    organizationId: 'org',
    projectId: 'project',
    issueId: 'issue',
    userId: 'anna',
    spentMinutes: 30,
    loggedAt: new Date('2026-08-24T09:00:00.000Z'),
    ...overrides,
  };
}

function eventLog(overrides = {}) {
  return {
    organizationId: 'org',
    projectId: 'project',
    issueId: '',
    sourceType: 'calendar_event',
    eventId: 'event',
    occurrenceStartAt: '2026-08-24T09:00:00.000Z',
    userId: 'anna',
    spentMinutes: 45,
    ...overrides,
  };
}

/** The one shape a delta set ever produces, so a test can read one day at a time. */
function day(deltas, dayKey = '2026-08-24', projectId = 'project') {
  return deltas.changed().find(entry => entry.day === dayKey && entry.projectId === projectId) || null;
}

test('a document id is organization, project and day, and nothing else', () => {
  assert.equal(analyticsRollupId('org', 'project', '2026-08-24'), 'org_project_2026-08-24');
  // Team calendar time hangs off no project, exactly as the raw log does.
  assert.equal(analyticsRollupId('org', '', '2026-08-24'), 'org__2026-08-24');
  assert.equal(analyticsRollupId('org', null, '2026-08-24'), 'org__2026-08-24');
});

// Which day an hour belongs to is a fact about the workspace, not about whoever
// opens the report. An evening in Kyiv is still that evening, and the same
// instant read in Los Angeles is the same working day.
test('a day is the day in the organization timezone', () => {
  const lateEvening = taskLog({ loggedAt: new Date('2026-08-24T21:30:00.000Z') });
  assert.equal(analyticsRollupDay(lateEvening, KYIV), '2026-08-25');
  assert.equal(analyticsRollupDay(lateEvening, 'America/Los_Angeles'), '2026-08-24');
  assert.equal(analyticsRollupDay(lateEvening, 'UTC'), '2026-08-24');

  // A calendar log is filed under its occurrence, which is what its `loggedAt`
  // is written from — so a recurring stand-up buckets identically either way.
  assert.equal(
    analyticsRollupDay(eventLog({ occurrenceStartAt: '2026-08-24T22:00:00.000Z' }), KYIV),
    '2026-08-25',
  );
  assert.equal(analyticsRollupDay({ loggedAt: null }, KYIV), '');
});

test('a Firestore Timestamp is a date like any other', () => {
  const stamp = { toDate: () => new Date('2026-08-24T09:00:00.000Z') };
  assert.equal(analyticsRollupDay({ loggedAt: stamp }, KYIV), '2026-08-24');
});

// An edit is the old record out and the new one in. This is the difference
// between a delta and an increment, and it is the whole reason a log corrected
// from 30 to 45 minutes moves the day by 15 rather than by 45.
test('editing a log moves the day by the difference, not by the new figure', () => {
  const stored = taskLog({ spentMinutes: 30 });
  const deltas = new AnalyticsRollupDeltas(KYIV);
  deltas.add(stored, -1);
  deltas.add({ ...stored, spentMinutes: 45 }, 1);

  assert.equal(day(deltas).taskMinutes, 15);
  assert.equal(day(deltas).minutesByUser.anna, 15);
});

test('two edits in a row do not compound', () => {
  const deltas = new AnalyticsRollupDeltas(KYIV);
  const first = taskLog({ spentMinutes: 30 });
  deltas.add(first, 1);
  deltas.add(first, -1);
  deltas.add({ ...first, spentMinutes: 45 }, 1);
  deltas.add({ ...first, spentMinutes: 45 }, -1);
  deltas.add({ ...first, spentMinutes: 60 }, 1);

  assert.equal(day(deltas).taskMinutes, 60);
});

test('deleting a log takes back exactly what it contributed', () => {
  const deltas = new AnalyticsRollupDeltas(KYIV);
  deltas.add(taskLog({ spentMinutes: 30 }), 1);
  deltas.add(taskLog({ spentMinutes: 30 }), -1);
  assert.deepEqual(deltas.changed(), []);
});

test('task hours and event hours are two figures in one day', () => {
  const deltas = new AnalyticsRollupDeltas(KYIV);
  deltas.add(taskLog({ spentMinutes: 30 }), 1);
  deltas.add(eventLog({ spentMinutes: 45 }), 1);

  const entry = day(deltas);
  assert.equal(entry.taskMinutes, 30);
  assert.equal(entry.eventMinutes, 45);
  // …and one figure per person, which is the whole of both.
  assert.equal(entry.minutesByUser.anna, 75);
});

// Cancelling is reversible and happens after the hours were already counted, so
// the correction is kept as its own figure rather than subtracted in place.
test('cancelling moves hours into their own figure and un-cancelling moves them back', () => {
  const log = taskLog({ spentMinutes: 30 });
  const cancel = new AnalyticsRollupDeltas(KYIV);
  cancel.addCancellation(log, 1);
  assert.equal(day(cancel).taskMinutes, 0, 'what was logged does not change');
  assert.equal(day(cancel).cancelledTaskMinutes, 30);
  assert.equal(day(cancel).cancelledMinutesByUser.anna, 30);

  const restore = new AnalyticsRollupDeltas(KYIV);
  restore.addCancellation(log, 1);
  restore.addCancellation(log, -1);
  assert.deepEqual(restore.changed(), [], 'un-cancelling is the exact inverse');
});

test('an event cannot be cancelled — only a task can', () => {
  const deltas = new AnalyticsRollupDeltas(KYIV);
  deltas.addCancellation(eventLog(), 1);
  assert.deepEqual(deltas.changed(), []);
});

// Logging time against a task that is already cancelled has to keep both
// figures true at once, whichever order the two events happen in.
test('hours logged to an already-cancelled task are counted and corrected together', () => {
  const deltas = new AnalyticsRollupDeltas(KYIV);
  deltas.add(taskLog({ spentMinutes: 30 }), 1, { cancelled: true });

  const entry = day(deltas);
  assert.equal(entry.taskMinutes, 30);
  assert.equal(entry.cancelledTaskMinutes, 30);
  assert.equal(countedTaskMinutes(entry), 0);
});

test('what a reader gets is what still counts', () => {
  const rollup = {
    taskMinutes: 120,
    cancelledTaskMinutes: 30,
    minutesByUser: { anna: 90, borys: 30 },
    cancelledMinutesByUser: { borys: 30 },
  };
  assert.equal(countedTaskMinutes(rollup), 90);
  assert.deepEqual(countedMinutesByUser(rollup), { anna: 90 });
  // A cancelled figure larger than the logged one is corruption, not a negative
  // number to render.
  assert.equal(countedTaskMinutes({ taskMinutes: 10, cancelledTaskMinutes: 40 }), 0);
});

// The rebuild is the reason this collection is allowed to exist. Whatever the
// incremental path did, running the totals again from the raw logs must produce
// the same numbers — that is what the backfill checks, and what makes a rollup
// a derived figure rather than a second source of truth.
test('rebuilding from raw logs reproduces what the incremental path wrote', () => {
  const logs = [
    taskLog({ spentMinutes: 30, userId: 'anna' }),
    taskLog({ spentMinutes: 45, userId: 'borys', issueId: 'cancelled-issue' }),
    eventLog({ spentMinutes: 60, userId: 'anna' }),
  ];

  const incremental = new AnalyticsRollupDeltas(KYIV);
  incremental.add(logs[0], 1);
  incremental.add(logs[1], 1);
  incremental.add(logs[2], 1);
  incremental.addCancellation(logs[1], 1);

  const rebuilt = rebuildRollupTotals({
    organizationId: 'org',
    projectId: 'project',
    day: '2026-08-24',
    logs,
    cancelledIssueIds: new Set(['cancelled-issue']),
  });

  assert.ok(rollupTotalsMatch(day(incremental), rebuilt));
  assert.equal(rebuilt.taskMinutes, 75);
  assert.equal(rebuilt.cancelledTaskMinutes, 45);
  assert.equal(rebuilt.eventMinutes, 60);
  assert.equal(countedTaskMinutes(rebuilt), 30);
});

test('minutes the accounting refuses are minutes the aggregate refuses', () => {
  const deltas = new AnalyticsRollupDeltas(KYIV);
  for (const bad of [0, -30, 1.5, 525_601, null, undefined, 'дві години']) {
    deltas.add(taskLog({ spentMinutes: bad }), 1);
  }
  assert.deepEqual(deltas.changed(), [], 'the same gate the invoice uses');
  // Including the coercion: `isValidRawTimeLogMinutes` reads '30' as thirty, so
  // a rollup that refused it would disagree with the invoice about the same log.
  deltas.add(taskLog({ spentMinutes: '30' }), 1);
  assert.equal(day(deltas).taskMinutes, 30);

  const rebuilt = rebuildRollupTotals({
    organizationId: 'org',
    projectId: 'project',
    day: '2026-08-24',
    logs: [taskLog({ spentMinutes: -30 }), taskLog({ spentMinutes: 30 })],
    cancelledIssueIds: new Set(),
  });
  assert.equal(rebuilt.taskMinutes, 30);
});

test('a day nothing moved on is not a write', () => {
  const deltas = new AnalyticsRollupDeltas(KYIV);
  deltas.add(taskLog({ spentMinutes: 30 }), 1);
  deltas.add(taskLog({ spentMinutes: 30 }), -1);
  deltas.add(taskLog({ spentMinutes: 15, loggedAt: new Date('2026-08-25T09:00:00.000Z') }), 1);

  const changed = deltas.changed();
  assert.equal(changed.length, 1);
  assert.equal(changed[0].day, '2026-08-25');
});

// ── The reading side ─────────────────────────────────────────────────────

test('a period is the sum of its days, per project and per person', () => {
  const rollups = [
    {
      organizationId: 'org', projectId: 'alpha', day: '2026-08-23',
      taskMinutes: 120, eventMinutes: 30, cancelledTaskMinutes: 0,
      minutesByUser: { anna: 90, borys: 60 }, cancelledMinutesByUser: {},
    },
    {
      organizationId: 'org', projectId: 'alpha', day: '2026-08-24',
      taskMinutes: 60, eventMinutes: 0, cancelledTaskMinutes: 60,
      minutesByUser: { anna: 60 }, cancelledMinutesByUser: { anna: 60 },
    },
    {
      organizationId: 'org', projectId: 'beta', day: '2026-08-24',
      taskMinutes: 45, eventMinutes: 0, cancelledTaskMinutes: 0,
      minutesByUser: { borys: 45 }, cancelledMinutesByUser: {},
    },
    // Team calendar time that hangs off no project.
    {
      organizationId: 'org', projectId: '', day: '2026-08-24',
      taskMinutes: 0, eventMinutes: 25, cancelledTaskMinutes: 0,
      minutesByUser: { anna: 25 }, cancelledMinutesByUser: {},
    },
  ];

  const all = summarizeRollups(rollups);
  // 120 + 30, then a day entirely cancelled out, then 45, then 25.
  assert.equal(all.totalMinutes, 220);
  assert.equal(all.minutesByProject.alpha, 150);
  assert.equal(all.minutesByProject.beta, 45);
  assert.equal(all.minutesByProject[''], 25);
  assert.equal(all.minutesByUser.anna, 115);
  assert.equal(all.minutesByUser.borys, 105);
  // The cancelled day contributed nothing, so it is not the day Anna was last
  // seen working.
  assert.equal(all.lastLoggedDayByUser.anna, '2026-08-24', 'the calendar hour is still hers');
  assert.equal(all.lastLoggedDayByUser.borys, '2026-08-24');

  // Selecting projects is a question about projects, so organization-wide
  // calendar time is not folded into whichever one is on screen.
  const alphaOnly = summarizeRollups(rollups, { projectIds: ['alpha'] });
  assert.equal(alphaOnly.totalMinutes, 150);
  assert.deepEqual(Object.keys(alphaOnly.minutesByProject), ['alpha']);
});

test('raw period logs keep task time separate from calendar-event time', () => {
  const summary = summarizeRawTimeLogs([
    taskLog({ projectId: 'puy', spentMinutes: 1 }),
    eventLog({ projectId: 'puy', spentMinutes: 3000 }),
    // A scheduled event's duration is deliberately absent here. Analytics is
    // about the time somebody logged, not how long the calendar slot was.
    taskLog({ projectId: 'other', spentMinutes: -15 }),
  ]);

  assert.equal(summary.taskMinutes, 1);
  assert.equal(summary.eventMinutes, 3000);
  assert.equal(summary.totalMinutes, 3001);
  assert.deepEqual(summary.minutesByProject, { puy: 3001 });
  assert.deepEqual(summary.minutesByUser, { anna: 3001 });
});

// qTicket publishes no analytics screen. The reading helpers above are what the
// backfill and the rebuild check themselves against, and nothing in the product
// draws a day — so there is no screen left here to hold to a read budget.

// ── The write paths ──────────────────────────────────────────────────────
//
// A derived total drifts silently: nothing breaks, a number simply stops being
// true, and the first person to notice is whoever believed it. So every place
// that can change how many minutes exist has to change the rollup in the same
// breath, and that is checked mechanically rather than remembered.
test('every path that changes logged minutes changes the daily totals with them', async () => {
  const [calendarLogs, cancel, trash, project] = await Promise.all([
    read('src/app/api/calendar/events/[eventId]/time-logs/route.js'),
    read('src/app/api/issues/[issueId]/cancel/route.js'),
    read('src/lib/server/issueTrash.js'),
    read('src/app/api/projects/[projectId]/route.js'),
  ]);

  // Calendar hours are the only ones a route still writes: three mutations,
  // three deltas.
  assert.equal(
    (calendarLogs.match(/writeAnalyticsRollupDeltas/g) || []).length,
    4,
    'the import plus one write for each of create, edit and delete',
  );

  // Cancelling and un-cancelling both correct the days the task has hours on.
  assert.match(cancel, /rollupDeltas\.addCancellation\(log, cancelled \? 1 : -1\)/);
  assert.match(cancel, /writeAnalyticsRollupDeltas/);

  // Deleting for real removes the hours; deleting a project removes its days.
  assert.match(trash, /removePurgedTimeLogsFromRollups/);
  assert.match(project, /deleteProjectAnalyticsRollups/);
});

test('a retried transaction does not log the same minutes twice', async () => {
  // Firestore re-runs a transaction body on contention, and every time entry
  // already writes the project document — which is exactly what two people
  // logging time in one project contend on. An accumulator built outside the
  // body and added to inside it therefore has to be emptied at the top of it,
  // or a retry files the same minutes again and the day is permanently over.
  //
  // This is not visible at the call site and nothing else would catch it: the
  // totals are an aggregate, and an aggregate that is wrong by one entry looks
  // exactly like an aggregate that is right.
  const files = [
    'src/app/api/calendar/events/[eventId]/time-logs/route.js',
    'src/app/api/issues/[issueId]/cancel/route.js',
  ];
  for (const file of files) {
    const source = await read(file);
    const outside = (source.match(/const rollupDeltas = await analyticsRollupDeltasFor/g) || []).length;
    const resets = (source.match(/rollupDeltas\.reset\(\)/g) || []).length;
    const bodies = (source.match(/await db\.runTransaction\(async transaction => \{[\s\S]{0,400}?rollupDeltas\.reset\(\)/g) || []).length;
    assert.ok(outside > 0, `${file} builds its accumulator outside the transaction`);
    assert.equal(resets, bodies, `${file} resets the accumulator at the top of every transaction that uses it`);
    assert.ok(resets > 0, `${file} never resets a rollup accumulator that outlives its transaction`);
  }
});

test('a browser can neither read nor write a daily total', async () => {
  const rules = await read('firestore.rules');
  // The rule used to let a project's members read their own days, because a
  // screen drew them. No screen does any more, and the transactions that keep
  // the totals reach Firestore through the Admin SDK, which rules do not gate —
  // so the collection is closed on both sides rather than left half-open.
  assert.match(rules, /match \/analyticsRollups\/\{id\} \{\s*allow read, write: if false;/);
});

test('the backfill can rebuild from nothing and says so when there is nothing to fix', async () => {
  const script = await read('scripts/backfill-analytics-rollups.mjs');
  // The conventions of docs/MIGRATIONS.md: dry run by default, an explicit
  // project, and an exact confirmation before anything is written.
  assert.match(script, /const APPLY = process\.argv\.includes\('--apply'\)/);
  assert.match(script, /Потрібен явний `--project/);
  assert.match(script, /CONFIRMED_PROJECT_ID !== FIREBASE_PROJECT_ID/);
  // A rebuild writes absolute totals. Merging would inherit the drift it exists
  // to remove.
  assert.match(script, /batch\.set\(db\.collection\(ANALYTICS_ROLLUPS_COLLECTION\)\.doc\(write\.id\)/);
  assert.doesNotMatch(script, /FieldValue\.increment/);
  // And a re-run is the proof the migration finished.
  assert.match(script, /Міграція завершена/);
  assert.equal(ANALYTICS_ROLLUP_VERSION, 1);
});
