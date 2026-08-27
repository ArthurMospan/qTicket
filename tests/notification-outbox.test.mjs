import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DISPATCH_BATCH,
  MAX_ATTEMPTS,
  cancellableRowIds,
  deliveryAttemptUpdate,
  dueRows,
  expirableNotificationIds,
  groupByRecipient,
  isTerminal,
  nextAttemptDelayMs,
  outboxRow,
  outboxRowChanges,
} from '../src/lib/utils/notificationOutbox.mjs';
import {
  addDaysToDayKey,
  calendarReminderCandidates,
  deadlineReminderCandidates,
  zonedHourToUtcMs,
} from '../src/lib/utils/reminderCandidates.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

test('a dispatch pass takes only what is due, in order, and bounded', () => {
  const now = 1_000_000;
  const rows = [
    { id: 'c', status: 'pending', deliverAtMs: now - 5 * MINUTE },
    { id: 'a', status: 'pending', deliverAtMs: now - 60 * MINUTE },
    { id: 'future', status: 'pending', deliverAtMs: now + MINUTE },
    { id: 'sent', status: 'sent', deliverAtMs: now - HOUR },
    { id: 'cancelled', status: 'cancelled', deliverAtMs: now - HOUR },
  ];
  assert.deepEqual(dueRows(rows, now).map(row => row.id), ['a', 'c']);
  assert.equal(dueRows(rows, now, 1).length, 1);
});

test('a row inside its backoff is skipped until the backoff expires', () => {
  const now = 1_000_000;
  const row = { id: 'r', status: 'pending', deliverAtMs: now - HOUR, nextAttemptAtMs: now + MINUTE };
  assert.equal(dueRows([row], now).length, 0);
  assert.equal(dueRows([row], now + 2 * MINUTE).length, 1);
});

test('retries back off and then stop', () => {
  assert.equal(nextAttemptDelayMs(0), MINUTE);
  assert.equal(nextAttemptDelayMs(3), 8 * MINUTE);
  assert.equal(nextAttemptDelayMs(99), 32 * MINUTE, 'capped');
  assert.equal(isTerminal({ status: 'failed', attempts: MAX_ATTEMPTS }), true);
  assert.equal(isTerminal({ status: 'failed', attempts: 1 }), false);
  assert.equal(isTerminal({ status: 'sent' }), true);
});

test('re-materialising corrects timing and wording but never identity or state', () => {
  const candidate = {
    id: 'calendar_reminder_e1_u1_123_15',
    userId: 'u1',
    organizationId: 'org',
    type: 'calendar_reminder',
    title: 'Синк',
    body: 'До початку 15 хв',
    link: '/calendar/event/e1',
    deliverAtMs: 5_000,
  };
  const stored = outboxRow(candidate);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.attempts, 0);

  // The event moved half an hour later.
  const moved = { ...candidate, deliverAtMs: 5_000 + 30 * MINUTE, title: 'Синк (перенесено)' };
  assert.deepEqual(outboxRowChanges(stored, moved), {
    deliverAtMs: 5_000 + 30 * MINUTE,
    title: 'Синк (перенесено)',
    nextAttemptAtMs: 5_000 + 30 * MINUTE,
  });
  // Nothing changed means no write.
  assert.deepEqual(outboxRowChanges(stored, candidate), {});
});

test('cancellation is confined to the window the pass can actually see', () => {
  const window = { windowStartMs: 1000, windowEndMs: 2000 };
  const pending = [
    { id: 'still-wanted', type: 'deadline', status: 'pending', deliverAtMs: 1500 },
    { id: 'orphan', type: 'deadline', status: 'pending', deliverAtMs: 1500 },
    { id: 'outside-window', type: 'deadline', status: 'pending', deliverAtMs: 9999 },
    { id: 'already-sent', type: 'deadline', status: 'sent', deliverAtMs: 1500 },
  ];
  assert.deepEqual(
    cancellableRowIds(pending, new Set(['still-wanted']), window),
    ['orphan'],
  );
});

// A retry row is a debt, not a derivation.
//
// `/api/notifications` writes one when somebody's Telegram or email did not
// answer. It carries the issueId of the task the event was about, and
// `deliverAtMs: now` — dead centre of every window this ever runs over. It is
// absent from the candidate list because no deadline produced it, and absence
// is not evidence about it: the event already happened and the person is still
// owed the message. Cancelling one is how somebody silently never hears that
// they were assigned a task.
test('a retry row owed to a person is not this pass to cancel', async () => {
  const window = { windowStartMs: 0, windowEndMs: 10_000 };
  const pending = [
    { id: 'deadline-orphan', type: 'deadline', status: 'pending', deliverAtMs: 1500 },
    { id: 'assigned-retry', type: 'assigned', status: 'pending', deliverAtMs: 1500 },
    { id: 'status-retry', type: 'status_changed', status: 'pending', deliverAtMs: 1500 },
    { id: 'mention-retry', type: 'mention', status: 'pending', deliverAtMs: 1500 },
  ];
  assert.deepEqual(cancellableRowIds(pending, new Set(), window), ['deadline-orphan']);

  // And the server reconciliation asks that same function rather than keeping
  // its own copy of the rule, which is how the two drifted apart in the first
  // place — a pure helper nothing called, next to a loop nothing tested.
  const source = await read('../src/lib/server/notificationOutbox.js');
  assert.match(source, /const cancellable = new Set\(cancellableRowIds\(/);
  assert.match(source, /\.select\('status', 'type', 'deliverAtMs'\)/);
});

test('one dispatch pass groups its rows into one message per person', () => {
  const grouped = groupByRecipient([
    { userId: 'a', id: '1' }, { userId: 'b', id: '2' }, { userId: 'a', id: '3' },
  ]);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('a').length, 2);
});

test('channel failures retry only the channel that did not succeed', () => {
  const nowMs = 1_000_000;
  const first = deliveryAttemptUpdate({ attempts: 0 }, {
    nowMs,
    emailRequested: true,
    emailSucceeded: true,
    telegramRequested: true,
    telegramSucceeded: false,
    telegramError: 'bot blocked',
  });
  assert.equal(first.failed, true);
  assert.equal(first.update.status, 'pending');
  assert.equal(first.update.emailSentAtMs, nowMs);
  assert.equal(first.update.telegramSentAtMs, undefined);
  assert.match(first.update.lastError, /bot blocked/);

  const retry = deliveryAttemptUpdate({ attempts: 1, emailSentAtMs: nowMs }, {
    nowMs: nowMs + 2 * MINUTE,
    telegramRequested: true,
    telegramSucceeded: true,
  });
  assert.equal(retry.failed, false);
  assert.equal(retry.update.status, 'sent');
  assert.equal(retry.update.emailSentAtMs, undefined, 'successful email is not sent or rewritten again');
  assert.equal(retry.update.telegramSentAtMs, nowMs + 2 * MINUTE);
});

test('a rejected email is not recorded as a successful notification', () => {
  const outcome = deliveryAttemptUpdate({ attempts: 0 }, {
    nowMs: 10_000,
    emailRequested: true,
    emailSucceeded: false,
    emailError: 'provider rejected the message',
  });
  assert.equal(outcome.failed, true);
  assert.equal(outcome.update.status, 'pending');
  assert.match(outcome.update.lastError, /provider rejected/);
});

test('candidates carry the moment they should arrive, not the moment they were found', () => {
  const start = Date.parse('2026-08-10T09:00:00.000Z');
  const nowMs = start - 3 * HOUR;
  const [candidate] = calendarReminderCandidates([{
    id: 'e1',
    organizationId: 'org',
    title: 'Синк',
    startAt: new Date(start).toISOString(),
    participantIds: ['u1'],
    reminderMinutes: [15],
  }], { nowMs, lookAheadMs: 4 * HOUR });

  assert.ok(candidate, 'a reminder three hours away is visible to a look-ahead pass');
  assert.equal(candidate.deliverAtMs, start - 15 * MINUTE);
  // And it is invisible without one, which is the old behaviour.
  assert.equal(calendarReminderCandidates([{
    id: 'e1',
    organizationId: 'org',
    title: 'Синк',
    startAt: new Date(start).toISOString(),
    participantIds: ['u1'],
    reminderMinutes: [15],
  }], { nowMs }).length, 0);
});

test('an overdue nag is delivered at a readable hour, in the organization timezone', () => {
  const nowMs = Date.parse('2026-08-10T00:30:00.000Z');
  const [candidate] = deadlineReminderCandidates([{
    id: 'i1',
    organizationId: 'org',
    projectId: 'p1',
    issueKey: 'QT-1',
    title: 'Задача',
    dueDate: '2026-08-09T12:00:00.000Z',
    assigneeIds: ['u1'],
    status: 'in-progress',
  }], {
    nowMs,
    closedStatusIdsByOrganization: new Map([['org', new Set(['done'])]]),
    timeZonesByOrganization: new Map([['org', 'Europe/Kyiv']]),
  });

  assert.ok(candidate);
  // 09:00 Kyiv on the nag day, which in August is 06:00 UTC — not 00:30, which
  // is when the sweep happened to notice it.
  assert.equal(new Date(candidate.deliverAtMs).toISOString(), '2026-08-10T06:00:00.000Z');
});

test('an upcoming deadline is announced twenty-four hours out', () => {
  const due = Date.parse('2026-08-12T15:00:00.000Z');
  const [candidate] = deadlineReminderCandidates([{
    id: 'i1',
    organizationId: 'org',
    projectId: 'p1',
    issueKey: 'QT-1',
    title: 'Задача',
    dueDate: new Date(due).toISOString(),
    assigneeIds: ['u1'],
    status: 'in-progress',
  }], {
    nowMs: due - 30 * HOUR,
    lookAheadMs: 12 * HOUR,
    closedStatusIdsByOrganization: new Map([['org', new Set(['done'])]]),
    timeZonesByOrganization: new Map([['org', 'Europe/Kyiv']]),
  });

  assert.ok(candidate);
  assert.equal(candidate.deliverAtMs, due - 24 * HOUR);
});

test('a wall-clock hour resolves to the right instant on both sides of DST', () => {
  // Kyiv is UTC+3 in summer and UTC+2 in winter.
  assert.equal(new Date(zonedHourToUtcMs('2026-08-10', 9, 'Europe/Kyiv')).toISOString(),
    '2026-08-10T06:00:00.000Z');
  assert.equal(new Date(zonedHourToUtcMs('2026-12-10', 9, 'Europe/Kyiv')).toISOString(),
    '2026-12-10T07:00:00.000Z');
  assert.equal(addDaysToDayKey('2026-08-31', 1), '2026-09-01');
});

test('the expensive half and the cheap half are separately drivable', async () => {
  const route = await read('../src/app/api/cron/notifications/route.js');
  assert.match(route, /new Set\(\['full', 'dispatch', 'maintenance', 'materialise', 'health'\]\)/);
  assert.match(route, /runScheduledNotificationSweep\(\{ mode: requested \}\)/);
  // An unknown mode is refused rather than silently treated as "everything".
  assert.match(route, /Unknown mode/);
  // Health answers before any sweeping happens. A check that had to run a pass
  // in order to report on one would be the thing it is watching.
  assert.ok(
    route.indexOf("if (requested === 'health')")
      < route.indexOf('runScheduledNotificationSweep({ mode: requested })'),
  );

  const jobs = await read('../src/lib/server/reminderJobs.js');
  // Dispatch runs after materialise, so a reminder that comes due inside a pass
  // leaves in that pass.
  assert.ok(
    jobs.indexOf('materialiseScheduledNotifications({ nowMs, lookBackMs })')
      < jobs.indexOf('dispatchDueNotifications({ nowMs })'),
  );
  // Once a night. The scan is the safety net now — the rows are written by the
  // route that accepted the deadline — and a safety net that runs seventy-two
  // times a day is the cost it was supposed to replace.
  //
  // Eleven hours, not twelve, and the hour is load-bearing: the two schedules
  // stand exactly twelve hours apart, so a guard of exactly twelve cancels the
  // second pass the moment GitHub delivers the first one late — which it did on
  // 27.08, and the day's recount went with it.
  assert.match(jobs, /MATERIALISE_INTERVAL_MS = 11 \* 60 \* 60 \* 1000/);
  const schedules = await read('../.github/workflows/scheduled-notifications.yml');
  const hours = [...schedules.matchAll(/cron: '(\d+) (\d+) \* \* \*'/g)].map(match => Number(match[2]));
  assert.equal(hours.length, 2, 'materialise still runs on two daily schedules');
  assert.equal(Math.abs(hours[0] - hours[1]), 12, 'and they are still twelve hours apart');
});

// Nothing read the sweep's watermark, so nothing could tell that the sweep had
// stopped. It stopped for twenty-four days in August 2026 and was found by hand.
test('the sweep can be asked whether it is still running, from outside itself', async () => {
  const jobs = await read('../src/lib/server/reminderJobs.js');
  assert.match(jobs, /export async function readSweepHealth/);
  assert.match(jobs, /export const SWEEP_SILENCE_LIMIT_MS/);

  // The check lives in its own workflow. What happened was that the sweep's
  // workflow was switched off; a check inside it would have gone quiet too.
  const watchdog = await read('../.github/workflows/sweep-watchdog.yml');
  assert.match(watchdog, /mode=health/);
  assert.match(watchdog, /503\)/);
  // And it must not run the sweep's driver, which treats 503 as «quota spent,
  // carry on» — correct there, and exactly backwards here.
  assert.doesNotMatch(watchdog, /run: bash \.github\/scripts\/sweep-notifications\.sh/);
});

// The pass that runs every minute is the one whose cost is multiplied by
// fourteen hundred, so it reads the outbox and nothing else.
test('a dispatch pass reads the outbox and nothing else', async () => {
  const jobs = await read('../src/lib/server/reminderJobs.js');
  const sweep = jobs.slice(jobs.indexOf('export async function runScheduledNotificationSweep'));
  // The watermark belongs to the expensive half. Reading it every minute
  // doubled the cost of an idle pass to learn something dispatch never uses.
  assert.match(sweep, /const state = wantsMaterialise\s*\n\s*\? await readSweepState\(nowMs\)/);
  // And it writes nothing: a status line written every minute is a hot document.
  assert.match(sweep, /if \(!wantsDispatch \|\| wantsMaterialise \|\| wantsMaintenance\) \{/);

  // The delivery-time query used to run beside the retry-time one on every
  // pass, to pick up rows from a schema nobody has written since. A query that
  // matches nothing still costs a read; at one a minute that was fourteen
  // hundred reads a day. It is the index fallback now, and only that.
  const outbox = await read('../src/lib/server/notificationOutbox.js');
  const dispatch = outbox.slice(outbox.indexOf('export async function dispatchDueNotifications'));
  assert.doesNotMatch(dispatch, /Promise\.all\(\[readyQuery\.get\(\), legacyQuery\.get\(\)\]\)/);
  assert.match(dispatch, /readySnapshot = await readyQuery\.get\(\);/);
});

// A reminder is written down when it becomes knowable, not found later.
//
// Materialising by scanning is what made a reminder cost the whole issue and
// calendarEvents collections on every pass. The row is a consequence of a
// write, so it is written by the write: the route that accepts a deadline
// records who has to be told and when, and the nightly scan is what catches
// whatever that missed.
test('setting a deadline writes its reminder down, rather than leaving it to be found', async () => {
  const [jobs, outbox] = await Promise.all([
    read('../src/lib/server/reminderJobs.js'),
    read('../src/lib/server/notificationOutbox.js'),
  ]);

  // One reconciliation, two ways of naming what it owns — so a row written by
  // the sweep and a row written by a deadline edit are the same row.
  assert.match(outbox, /export async function reconcileScopedRows\(/);
  assert.match(outbox, /\.where\(field, '==', value\)/);
  assert.match(outbox, /\.where\('status', '==', 'pending'\)/);
  assert.match(outbox, /\.limit\(SCOPED_ROW_LIMIT\)/);
  assert.match(jobs, /export async function syncIssueReminderRows\(/);
  assert.match(jobs, /export async function syncCalendarEventReminderRows\(/);

  // Every server route that can change when somebody must be reminded.
  const callers = [
    'src/app/api/issues/route.js',
    'src/app/api/issues/bulk/route.js',
    'src/app/api/issues/[issueId]/route.js',
    'src/app/api/issues/[issueId]/status/route.js',
    'src/app/api/issues/[issueId]/archive/route.js',
    'src/app/api/issues/[issueId]/cancel/route.js',
    'src/app/api/issues/[issueId]/restore/route.js',
    'src/app/api/issues/[issueId]/reminders/route.js',
  ];
  for (const file of callers) {
    assert.match(
      await read(`../${file}`),
      /syncIssueReminderRows/,
      `${file} changes when a reminder is owed and must say so`,
    );
  }
  for (const file of [
    'src/app/api/calendar/events/route.js',
    'src/app/api/calendar/events/[eventId]/route.js',
  ]) {
    assert.match(await read(`../${file}`), /syncCalendarEventReminderRows/, file);
  }

  // And the route that recomputes on the browser's behalf verifies the token
  // before it reads anything. Reading the task first — to learn which
  // organization to authorize against — is an unauthenticated Firestore read
  // anybody can ask for at any rate they like, against a daily read cap.
  const remindersRoute = await read('../src/app/api/issues/[issueId]/reminders/route.js');
  const gate = remindersRoute.indexOf('authenticateRequest(request)');
  const firstRead = remindersRoute.indexOf('.doc(issueId).get()');
  assert.ok(gate > 0 && firstRead > gate, 'the token is checked before the first read');
  assert.ok(
    remindersRoute.indexOf('enforceRateLimit') < firstRead,
    'the rate limit is keyed to a verified person, before anything is read',
  );
  // The deadline is still written straight from the browser, and the browser
  // cannot write the queue — so the composer asks the server to recompute it.
  const service = await read('../src/lib/services/issues.js');
  assert.match(service, /export function syncIssueRemindersViaApi/);
  assert.match(service, /const REMINDER_FIELDS = \['dueDate', 'assigneeIds'\]/);
  for (const file of ['../src/lib/hooks/useIssues.js', '../src/lib/hooks/useAllMyTasks.js']) {
    assert.match(await read(file), /syncIssueRemindersViaApi\(/, file);
  }

  // And the scoped query has an index to run against.
  const indexes = JSON.parse(await read('../firestore.indexes.json')).indexes;
  const paths = indexes
    .filter(entry => entry.collectionGroup === 'scheduledNotifications')
    .map(entry => entry.fields.map(field => field.fieldPath).join(','));
  assert.ok(paths.includes('issueId,status'), 'a task\'s own rows need (issueId, status)');
  assert.ok(paths.includes('calendarEventId,status'), 'an event\'s own rows need (calendarEventId, status)');
});

// The scan that remains is the safety net, and a safety net still has to be
// bounded — the whole reason it ran the workspace out of quota was a query with
// no edge.
test('the nightly scan is bounded on both sides', async () => {
  const [jobs, candidates] = await Promise.all([
    read('../src/lib/server/reminderJobs.js'),
    read('../src/lib/utils/reminderCandidates.mjs'),
  ]);
  // Deadlines: a week back, because that is what an overdue nag can still reach.
  assert.match(candidates, /DEADLINE_FLOOR_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  // One-off events already had a window. Recurring ones did not have one at
  // all: their start is in the past forever, so the query read every series
  // ever created, with no ceiling and no edge.
  assert.match(jobs, /const RECURRING_SCAN_LIMIT = 500;/);
  const recurring = jobs.slice(jobs.indexOf('const recurringQuery'));
  assert.match(recurring, /\.where\('startAt', '<=', Timestamp\.fromMillis\(nowMs \+ CALENDAR_LEAD_MS\)\)/);
  assert.match(recurring, /\.limit\(RECURRING_SCAN_LIMIT\)/);
});

test('the outbox query has an index to run against', async () => {
  const indexes = JSON.parse(await read('../firestore.indexes.json'));
  const match = indexes.indexes.find(entry => entry.collectionGroup === 'scheduledNotifications'
    && entry.fields.some(field => field.fieldPath === 'nextAttemptAtMs'));
  assert.ok(match, 'scheduledNotifications has no composite index');
  assert.deepEqual(match.fields.map(field => field.fieldPath), ['status', 'nextAttemptAtMs']);
});

test('the outbox is server-only: no client rule grants it', async () => {
  const rules = await read('../firestore.rules');
  // Unmatched paths deny by default, so the requirement is that nobody added a
  // match for it — not that a deny rule exists.
  assert.doesNotMatch(rules, /scheduledNotifications/);
});

test('a dispatch pass is bounded so a backlog drains instead of timing out', async () => {
  const source = await read('../src/lib/server/notificationOutbox.js');
  assert.match(source, /\.limit\(limit\)/);
  assert.match(source, /\.where\('nextAttemptAtMs', '<=', nowMs\)/);
  assert.match(source, /error\?\.code !== 9 && error\?\.code !== 'failed-precondition'/);
  assert.match(source, /batch\.update\(document\.ref, \{ nextAttemptAtMs:/);
  assert.equal(DISPATCH_BATCH, 50);
  // And the record is claimed before the outbound send, so a crash mid-send
  // cannot produce a second bell entry on retry.
  const dispatch = source.slice(source.indexOf('export async function dispatchDueNotifications'));
  assert.ok(dispatch.indexOf('claimNotification(row') < dispatch.indexOf('deliverTelegramNotification'));
});

test('a reminder something else already delivered is not delivered a second time', async () => {
  const source = await read('../src/lib/server/notificationOutbox.js');
  const dispatch = source.slice(source.indexOf('export async function dispatchDueNotifications'));
  // The notification document is the "already told them" marker. Finding it on
  // a *first* attempt means another mechanism sent this exact reminder — the
  // old polling sweep, a manual run — and sending again is the duplicate the
  // whole change exists to stop.
  assert.match(dispatch, /const isFirstAttempt = Number\(row\.attempts \|\| 0\) === 0;/);
  assert.match(dispatch, /if \(!claimedNow && isFirstAttempt\) \{/);
  assert.match(dispatch, /lastError: 'already delivered'/);
  // But on a retry the document is expected to exist, because we wrote it — so
  // the skip must not apply there, or a failed Telegram send could never retry.
  assert.ok(
    dispatch.indexOf('isFirstAttempt') < dispatch.indexOf('claimed.push'),
    'the guard has to run before the row joins the send list',
  );
});

test('a read record past its date goes, unless something could resend it', () => {
  const rows = new Map([
    ['deadline-pending', { status: 'pending', attempts: 2 }],
    ['deadline-sent', { status: 'sent', attempts: 1 }],
    ['deadline-exhausted', { status: 'failed', attempts: MAX_ATTEMPTS }],
    ['deadline-failing', { status: 'failed', attempts: 1 }],
  ]);
  const removable = expirableNotificationIds([
    { id: 'commented-1', type: 'commented' },
    { id: 'chat-1', type: 'chat_message' },
    { id: 'deadline-pending', type: 'deadline' },
    { id: 'deadline-sent', type: 'deadline' },
    { id: 'deadline-exhausted', type: 'deadline' },
    { id: 'deadline-failing', type: 'deadline' },
    { id: 'deadline-orphan', type: 'deadline' },
  ], rows);

  // An event that happened once cannot happen again, so its record is only a
  // record.
  assert.ok(removable.includes('commented-1'));
  assert.ok(removable.includes('chat-1'));
  // A terminal row is the guard now: the dispatcher will never look at it again.
  assert.ok(removable.includes('deadline-sent'));
  assert.ok(removable.includes('deadline-exhausted'));
  // No row at all, on a record old enough to expire, is a reminder nothing will
  // materialise again — the window looks hours ahead, not weeks behind.
  assert.ok(removable.includes('deadline-orphan'));
  // A row still pending is a retry in flight, and a retry recreates the document
  // it cannot find. Deleting the record here is exactly how a reminder is sent
  // twice.
  assert.equal(removable.includes('deadline-pending'), false);
  assert.equal(removable.includes('deadline-failing'), false);
});

test('expiry runs on the slow pass, and pays for what it deletes and nothing else', async () => {
  const source = await read('../src/lib/server/reminderJobs.js');
  const prune = source.slice(source.indexOf('export async function pruneReadNotifications'));
  // One bounded indexed query. An empty result is the whole cost of a tidy bell.
  assert.match(prune, /\.where\('read', '==', true\)/);
  assert.match(prune, /\.limit\(limit\)/);
  assert.match(prune, /\.select\('type'\)/);
  // The guard is only read for the types that can be resent at all.
  assert.match(prune, /record\.type === 'deadline' \|\| record\.type === 'calendar_reminder'/);
  assert.match(prune, /expirableNotificationIds\(records, rows\)/);
  // Never on the every-minute dispatch pass — and no longer only on the
  // nightly one either. «Нещодавно видалене» promises twenty-four hours, and a
  // nightly purge makes that up to forty-eight, so both of these run on their
  // own hourly pass.
  assert.match(source, /const issueTrash = wantsMaintenance\s*\n\s*\? await purgeExpiredDeletedIssues/);
  assert.match(source, /const prunedNotifications = wantsMaintenance\s*\n\s*\? await pruneReadNotifications/);
});

test('an event-driven message that failed to leave is owed, not lost', async () => {
  const route = await read('../src/app/api/notifications/route.js');
  const queue = route.slice(route.indexOf('async function queueFailedChannels'));
  // The retry row carries the id of the record this request already wrote, so a
  // retry claims that one rather than writing a second.
  assert.match(route, /recordIdByUser\.set\(item\.userId, id\)/);
  assert.match(route, /recordIdByUser\.set\(delivery\.userId, ref\.id\)/);
  assert.match(queue, /recordIdByUser\.get\(item\.userId\)/);
  // One attempt is already spent — otherwise the dispatcher reads its own
  // record as somebody else's delivery and closes the row without sending.
  assert.match(queue, /attempts: 1,/);
  assert.match(queue, /nextAttemptAtMs: nowMs \+ nextAttemptDelayMs\(1\)/);
  // A channel that went through is not sent again.
  assert.match(queue, /emailSentAtMs: nowMs/);
  assert.match(queue, /telegramSentAtMs: nowMs/);
  // And a row is only written for somebody actually owed something.
  assert.match(queue, /if \(!owed\.length\) return;/);
});

test('the immediate path still knows whether it delivered', async () => {
  const route = await read('../src/app/api/notifications/route.js');
  // `sendEmail` used to swallow its own answer, which is why a dead provider was
  // invisible: there was nothing to be false.
  assert.match(route, /return deliverEmail\(\{/);
  assert.match(route, /result\.status === 'rejected' \|\| result\.value !== true/);
  // A Telegram call that throws means nobody in it was reached, not that
  // everybody was.
  assert.match(route, /failedUserIds: telegramTargets\.map\(item => item\.userId\)/);
});
