import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_REMINDER_LOOKBACK_MS,
  REMINDER_LOOKBACK_MS,
  clampReminderLookback,
  dayKeyInTimeZone,
  deadlineReminderCandidates,
  overdueNagDue,
} from '../src/lib/utils/reminderCandidates.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

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

  // The scheduled query is bounded on both sides.
  assert.match(source, /\.where\('dueDate', '>=', Timestamp\.fromMillis\(nowMs - DEADLINE_FLOOR_MS\)\)/);
  assert.match(source, /\.where\('dueDate', '<=', Timestamp\.fromMillis\(nowMs \+ DEADLINE_HORIZON_MS \+ lookAheadMs\)\)/);
});
