import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_REMINDER_LOOKBACK_MS,
  REMINDER_LOOKBACK_MS,
  calendarReminderCandidates,
  clampReminderLookback,
  dayKeyInTimeZone,
  deadlineReminderCandidates,
  overdueNagDue,
  reminderLabel,
} from '../src/lib/utils/reminderCandidates.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

test('calendar reminders are produced server-side for accepted participants only', () => {
  const nowMs = Date.parse('2026-07-29T08:45:00.000Z');
  const candidates = calendarReminderCandidates([{
    id: 'event-1',
    organizationId: 'org-1',
    organizerId: 'owner-1',
    title: 'Синк команди',
    startAt: '2026-07-29T09:00:00.000Z',
    participantIds: ['member-1', 'member-2'],
    participantResponses: { 'member-1': 'accepted', 'member-2': 'declined' },
    reminderMinutes: [15],
    recurrence: { frequency: 'none' },
  }], { nowMs });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].userId, 'member-1');
  assert.equal(
    candidates[0].id,
    `calendar_reminder_event-1_member-1_${Date.parse('2026-07-29T09:00:00.000Z')}_15`,
  );
  assert.equal(candidates[0].body, 'До початку 15 хв');
});

test('a removed recurring occurrence does not produce a reminder', () => {
  const occurrence = '2026-07-29T09:00:00.000Z';
  const candidates = calendarReminderCandidates([{
    id: 'event-series',
    organizationId: 'org-1',
    organizerId: 'owner-1',
    title: 'Щоденний синк',
    startAt: occurrence,
    participantIds: ['member-1'],
    reminderMinutes: [15],
    recurrence: { frequency: 'daily', interval: 1, until: '' },
    excludedOccurrenceStarts: [occurrence],
  }], { nowMs: Date.parse('2026-07-29T08:45:00.000Z') });

  assert.equal(candidates.length, 0);
});

test('calendar reminder look-back catches a missed scheduler tick without duplicates', () => {
  const candidates = calendarReminderCandidates([{
    id: 'event-2',
    organizationId: 'org-1',
    title: 'Реліз',
    startAt: '2026-07-29T09:00:00.000Z',
    participantIds: ['member-1'],
    reminderMinutes: [15],
  }], {
    nowMs: Date.parse('2026-07-29T08:49:00.000Z'),
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 'calendar_reminder_event-2_member-1_1785315600000_15');
});

test('deadline candidates skip terminal issues and dedupe the overdue nag per day', () => {
  const nowMs = Date.parse('2026-07-29T09:00:00.000Z');
  const candidates = deadlineReminderCandidates([
    {
      id: 'issue-open',
      organizationId: 'org-1',
      projectId: 'project-1',
      issueKey: 'QT-12',
      title: 'Виправити Telegram',
      dueDate: '2026-07-28T18:00:00.000Z',
      assigneeIds: ['member-1'],
      status: 'in-progress',
    },
    {
      id: 'issue-done',
      organizationId: 'org-1',
      projectId: 'project-1',
      issueKey: 'QT-13',
      title: 'Готово',
      dueDate: '2026-07-28T18:00:00.000Z',
      assigneeIds: ['member-1'],
      status: 'closed',
    },
  ], {
    nowMs,
    closedStatusIdsByOrganization: new Map([['org-1', new Set(['closed'])]]),
    timeZonesByOrganization: new Map([['org-1', 'Europe/Kyiv']]),
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 'overdue_issue-open_member-1_2026-07-29');
  assert.match(candidates[0].title, /дедлайн прострочено/);
});

test('day keys honor the organization timezone', () => {
  const instant = Date.parse('2026-07-28T21:30:00.000Z');
  assert.equal(dayKeyInTimeZone(instant, 'Europe/Kyiv'), '2026-07-29');
  assert.equal(dayKeyInTimeZone(instant, 'America/New_York'), '2026-07-28');
});

test('a late sweep says how late it is instead of repeating the configured lead', () => {
  // The scheduler that drives the sweep runs roughly hourly, so "нагадати за 15
  // хвилин" is routinely delivered after the meeting has started. Announcing
  // "До початку 15 хв" then is worse than silence.
  const start = Date.parse('2026-07-29T09:00:00.000Z');
  const candidates = calendarReminderCandidates([{
    id: 'event-late',
    organizationId: 'org-1',
    title: 'Синк команди',
    startAt: '2026-07-29T09:00:00.000Z',
    participantIds: ['member-1'],
    reminderMinutes: [15],
  }], {
    nowMs: start + 40 * MINUTE,
    lookBackMs: 2 * 60 * MINUTE,
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].body, 'Подія почалася 40 хв тому');
  // Same occurrence, same id: a late delivery is still one delivery.
  assert.equal(candidates[0].id, `calendar_reminder_event-late_member-1_${start}_15`);
});

test('reminder labels read naturally on both sides of the start', () => {
  assert.equal(reminderLabel(15 * MINUTE), 'До початку 15 хв');
  assert.equal(reminderLabel(90 * MINUTE), 'До початку 1 год 30 хв');
  assert.equal(reminderLabel(120 * MINUTE), 'До початку 2 год');
  assert.equal(reminderLabel(2 * DAY), 'До початку 2 дн');
  assert.equal(reminderLabel(0), 'Подія починається зараз');
  assert.equal(reminderLabel(-5 * MINUTE), 'Подія почалася 5 хв тому');
  assert.equal(reminderLabel(-125 * MINUTE), 'Подія почалася 2 год 5 хв тому');
});

test('the look-back stretches to cover a missed scheduler gap and stops at half a day', () => {
  assert.equal(clampReminderLookback(60_000), REMINDER_LOOKBACK_MS, 'never narrower than the floor');
  assert.equal(clampReminderLookback(3 * 60 * MINUTE), 3 * 60 * MINUTE, 'covers the real gap');
  assert.equal(clampReminderLookback(7 * DAY), MAX_REMINDER_LOOKBACK_MS, 'a week of outage is not a week of pings');
  assert.equal(clampReminderLookback(Number.NaN), REMINDER_LOOKBACK_MS);
});

test('an overdue task nags on the day, the day after, then weekly — not every day forever', () => {
  assert.equal(overdueNagDue(0), true);
  assert.equal(overdueNagDue(1), true);
  assert.equal(overdueNagDue(2), false);
  assert.equal(overdueNagDue(6), false);
  assert.equal(overdueNagDue(7), true);
  assert.equal(overdueNagDue(13), false);
  assert.equal(overdueNagDue(14), true);
});

const overdueIssue = dueDate => ({
  id: 'issue-open',
  organizationId: 'org-1',
  projectId: 'project-1',
  issueKey: 'QT-12',
  title: 'Виправити Telegram',
  dueDate,
  assigneeIds: ['member-1'],
  status: 'in-progress',
});

const sweepOverdue = (dueDate, nowMs) => deadlineReminderCandidates([overdueIssue(dueDate)], {
  nowMs,
  closedStatusIdsByOrganization: new Map([['org-1', new Set(['closed'])]]),
  timeZonesByOrganization: new Map([['org-1', 'Europe/Kyiv']]),
});

test('a task overdue for three days stays quiet, and says how long once it speaks', () => {
  const due = '2026-07-01T09:00:00.000Z';
  assert.equal(sweepOverdue(due, Date.parse('2026-07-04T09:00:00.000Z')).length, 0);

  const week = sweepOverdue(due, Date.parse('2026-07-08T09:00:00.000Z'));
  assert.equal(week.length, 1);
  assert.equal(week[0].title, 'QT-12: дедлайн прострочено на 7 дн');
  assert.equal(week[0].id, 'overdue_issue-open_member-1_2026-07-08');
});

test('a deadline older than the query floor produces nothing at all', () => {
  // The floor is what lets the Firestore query be bounded on both sides instead
  // of reading every issue that ever slipped, on every pass, forever.
  const ancient = sweepOverdue('2025-01-01T09:00:00.000Z', Date.parse('2026-07-29T09:00:00.000Z'));
  assert.equal(ancient.length, 0);
});

test('the sweep remembers materialisation separately and never advances it on failure', async () => {
  const source = await read('../src/lib/server/reminderJobs.js');
  assert.match(source, /clampReminderLookback\(state\.materialiseElapsedMs\)/);
  assert.match(source, /nowMs - lastMaterialiseAt/);
  // The watermark write is after the awaited work, so a throw skips it.
  const sweep = source.slice(source.indexOf('export async function runScheduledNotificationSweep'));
  assert.ok(
    sweep.indexOf('await dispatchDueNotifications') < sweep.indexOf('lastRunAtMs: nowMs'),
    'the watermark must be written after the sweep, not before',
  );

  // Both scheduled queries are bounded on both sides.
  assert.match(source, /\.where\('dueDate', '>=', Timestamp\.fromMillis\(nowMs - DEADLINE_FLOOR_MS\)\)/);
  assert.match(source, /\.where\('startAt', '<=', Timestamp\.fromMillis\(nowMs \+ CALENDAR_LEAD_MS\)\)/);
});

test('one sweep sends one Telegram digest per person', async () => {
  const source = await read('../src/lib/server/reminderJobs.js');
  // Claiming no longer sends; it hands the item back to be batched.
  const claim = source.slice(
    source.indexOf('async function claimAndDeliver'),
    source.indexOf('async function deliverTelegramDigests'),
  );
  assert.doesNotMatch(claim, /deliverTelegramNotification/);
  assert.match(source, /deliverTelegramDigests\(results\)/);
  assert.match(source, /itemsByUserId,/);
});
