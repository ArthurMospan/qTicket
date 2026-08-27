import { expandOccurrences } from './calendarRecurrence.mjs';
import { isArchivedIssue } from './issueArchive.mjs';
import { isCancelledIssue } from './issueCancel.mjs';
import { DAILY_REMINDER_HOUR } from './notificationOutbox.mjs';
import {
  DEFAULT_ORGANIZATION_TIME_ZONE,
  dayKeyInTimeZone,
  zonedDateTimeToUtcMs,
} from './timeZone.mjs';

export { dayKeyInTimeZone } from './timeZone.mjs';

// The floor for one sweep's look-back. The sweep is *supposed* to run every few
// minutes; when it does, this is the whole window.
export const REMINDER_LOOKBACK_MS = 10 * 60 * 1000;
// The ceiling. The scheduler that drives the sweep is not reliable (GitHub
// Actions throttles `*/5 * * * *` down to roughly hourly, and to three hours
// overnight), and a fixed ten-minute window silently threw away every reminder
// whose trigger fell in a gap. The sweep now carries its own watermark and asks
// for `now - lastRun`, clamped here so a scheduler that was down for a week does
// not deliver a week of stale reminders in one burst.
export const MAX_REMINDER_LOOKBACK_MS = 12 * 60 * 60 * 1000;
export const DEADLINE_HORIZON_MS = 24 * 60 * 60 * 1000;
// Overdue tasks used to renotify every single day, forever, which is the bulk of
// what reads as "the same notification over and over". They now nag on the day
// the deadline slips, the day after, and weekly from then on.
export const OVERDUE_NAG_DAYS = new Set([0, 1]);
export const OVERDUE_NAG_INTERVAL_DAYS = 7;
// A deadline older than this stops producing candidates altogether. It also
// bounds the Firestore query that feeds the sweep: without a floor it read every
// issue that had ever been overdue, on every pass, forever.
//
// Four months was the floor while the sweep was the only thing that ever wrote
// a reminder down, and it had to be generous enough to re-find anything it had
// missed. Rows are written when the deadline is set now, so this query is the
// safety net rather than the mechanism, and it only has to cover the nags an
// overdue task still produces: the day it slips, the day after, and weekly.
// A week finds every one of those; four months read a hundred and thirteen days
// of settled deadlines to produce nothing.
export const DEADLINE_FLOOR_MS = 7 * 24 * 60 * 60 * 1000;

export function clampReminderLookback(elapsedMs) {
  if (!Number.isFinite(elapsedMs)) return REMINDER_LOOKBACK_MS;
  return Math.min(Math.max(elapsedMs, REMINDER_LOOKBACK_MS), MAX_REMINDER_LOOKBACK_MS);
}

function asDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

// The instant of a wall-clock hour on a given day in a given timezone.
//
// Day-scale reminders have to land at a civilised hour rather than whenever the
// scheduler happens to notice them, and "09:00" means 09:00 where the
// organization is. Deadline inputs use this same wall-clock converter, so the
// UI and the scheduler cannot drift onto different timezone arithmetic.
export function zonedHourToUtcMs(
  dayKey,
  hour,
  timeZone = DEFAULT_ORGANIZATION_TIME_ZONE,
) {
  return zonedDateTimeToUtcMs(dayKey, { hour }, timeZone);
}

export function addDaysToDayKey(dayKey, days) {
  const base = Date.parse(`${dayKey}T00:00:00.000Z`);
  if (!Number.isFinite(base)) return '';
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function dayOffsetBetweenKeys(fromKey, toKey) {
  if (!fromKey || !toKey) return null;
  const from = Date.parse(`${fromKey}T00:00:00.000Z`);
  const to = Date.parse(`${toKey}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

// The label describes the distance to the event *at delivery*, not the reminder
// that was configured. A sweep that runs an hour late used to send "До початку
// 15 хв" about a meeting that had already finished, which is worse than sending
// nothing: it teaches the reader that QuickTeam's reminders are fiction.
export function reminderLabel(msUntilStart) {
  const minutes = Math.round(msUntilStart / 60_000);
  if (minutes <= 0) {
    const late = Math.abs(minutes);
    if (late === 0) return 'Подія починається зараз';
    if (late < 60) return `Подія почалася ${late} хв тому`;
    const hours = Math.floor(late / 60);
    const rest = late % 60;
    return rest
      ? `Подія почалася ${hours} год ${rest} хв тому`
      : `Подія почалася ${hours} год тому`;
  }
  if (minutes < 60) return `До початку ${minutes} хв`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `До початку ${hours} год ${rest} хв` : `До початку ${hours} год`;
  }
  const days = Math.round(minutes / 1440);
  return `До початку ${days} дн`;
}

// `lookAheadMs` is what turns this from "what should I send right now?" into
// "what will need sending soon?" — the question the outbox materialiser asks.
// At zero the behaviour is unchanged.
export function calendarReminderCandidates(
  events,
  {
    nowMs = Date.now(),
    lookBackMs = REMINDER_LOOKBACK_MS,
    lookAheadMs = 0,
    recipientId = '',
  } = {},
) {
  const candidates = [];

  for (const event of events || []) {
    const start = asDate(event.startAt);
    const participantIds = [...new Set(
      (Array.isArray(event.participantIds) ? event.participantIds : [])
        .filter(value => typeof value === 'string' && value.length > 0),
    )];
    const recipients = recipientId
      ? participantIds.filter(userId => userId === recipientId)
      : participantIds;
    const reminders = [...new Set(
      (Array.isArray(event.reminderMinutes) ? event.reminderMinutes : [15])
        .map(Number)
        .filter(Number.isFinite)
        .filter(minutes => minutes >= 0),
    )];
    if (!event.id || !event.organizationId || !start || !recipients.length || !reminders.length) continue;

    const maxReminderMs = Math.max(...reminders) * 60 * 1000;
    const { occurrences } = expandOccurrences({
      start,
      frequency: event.recurrence?.frequency || 'none',
      interval: event.recurrence?.interval,
      until: event.recurrence?.until ? `${event.recurrence.until}T23:59:59.999Z` : null,
      windowStart: new Date(nowMs - lookBackMs),
      windowEnd: new Date(nowMs + maxReminderMs + lookAheadMs + 5 * 60 * 1000),
      maxOccurrences: 64,
    });
    const excludedOccurrences = new Set(event.excludedOccurrenceStarts || []);

    for (const occurrence of occurrences) {
      if (excludedOccurrences.has(occurrence.toISOString())) continue;
      for (const minutes of reminders) {
        const triggerAt = occurrence.getTime() - minutes * 60 * 1000;
        if (triggerAt > nowMs + lookAheadMs || triggerAt < nowMs - lookBackMs) continue;
        for (const userId of recipients) {
          if (event.participantResponses?.[userId] === 'declined') continue;
          candidates.push({
            id: `calendar_reminder_${event.id}_${userId}_${occurrence.getTime()}_${minutes}`,
            userId,
            organizationId: event.organizationId,
            type: 'calendar_reminder',
            title: event.title || 'Подія',
            // Correct for a reminder being sent the moment it is due. When it is
            // materialised ahead of time the dispatcher recomputes it from
            // occurrenceStart, because by then the distance has changed.
            body: reminderLabel(occurrence.getTime() - Math.max(nowMs, triggerAt)),
            calendarEventId: event.id,
            occurrenceStart: occurrence.getTime(),
            deliverAtMs: triggerAt,
            actorId: event.organizerId || '',
          });
        }
      }
    }
  }

  return candidates;
}

export function overdueNagDue(overdueDays) {
  if (!Number.isFinite(overdueDays) || overdueDays < 0) return false;
  if (OVERDUE_NAG_DAYS.has(overdueDays)) return true;
  return overdueDays % OVERDUE_NAG_INTERVAL_DAYS === 0;
}

export function deadlineReminderCandidates(
  issues,
  {
    nowMs = Date.now(),
    lookAheadMs = 0,
    closedStatusIdsByOrganization = new Map(),
    timeZonesByOrganization = new Map(),
  } = {},
) {
  const candidates = [];
  const horizon = nowMs + DEADLINE_HORIZON_MS + lookAheadMs;
  const floor = nowMs - DEADLINE_FLOOR_MS;

  for (const issue of issues || []) {
    const dueDate = asDate(issue.dueDate);
    const assigneeIds = [...new Set(
      (Array.isArray(issue.assigneeIds) ? issue.assigneeIds : [])
        .filter(value => typeof value === 'string' && value.length > 0),
    )];
    if (!issue.id || !issue.organizationId || !issue.projectId || !dueDate || !assigneeIds.length) continue;
    if (dueDate.getTime() > horizon || dueDate.getTime() < floor) continue;

    const closedStatusIds = closedStatusIdsByOrganization.get(issue.organizationId) || new Set(['done']);
    if (closedStatusIds.has(issue.columnId || issue.status)) continue;
    // A task in the archive is not work anybody is expected to do, so its
    // deadline is not news. Reminding somebody about a task they deliberately
    // put aside — and cannot see on any board — is the definition of noise.
    if (isArchivedIssue(issue) || isCancelledIssue(issue)) continue;

    const timeZone = timeZonesByOrganization.get(issue.organizationId)
      || DEFAULT_ORGANIZATION_TIME_ZONE;
    const dueDayKey = dayKeyInTimeZone(dueDate, timeZone);
    const currentDayKey = dayKeyInTimeZone(nowMs, timeZone);
    const overdue = dueDayKey < currentDayKey;
    const dayKey = overdue
      ? currentDayKey
      : dueDayKey;
    // How long it has been overdue, counted in the organization's calendar days
    // rather than in raw milliseconds: "прострочено вчора" has to mean yesterday
    // in Kyiv, not 24 hours ago.
    const overdueDays = overdue
      ? dayOffsetBetweenKeys(dueDayKey, dayKey)
      : 0;
    if (overdue && !overdueNagDue(overdueDays)) continue;
    let dueLabel = '';
    try {
      dueLabel = dueDate.toLocaleDateString('uk-UA', {
        day: 'numeric',
        month: 'long',
        timeZone,
      });
    } catch {
      dueLabel = dueDate.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
    }

    // When this should actually arrive. An overdue nag belongs to a day, so it
    // lands at a readable hour in the organization's timezone instead of
    // whenever the scheduler first noticed it — which, on a healthy cadence,
    // means a few minutes past midnight. A "deadline tomorrow" belongs to the
    // twenty-four-hour mark, or to now if the deadline was set later than that.
    const deliverAtMs = overdue
      ? Math.max(zonedHourToUtcMs(dayKey, DAILY_REMINDER_HOUR, timeZone), dueDate.getTime())
      : Math.max(dueDate.getTime() - DEADLINE_HORIZON_MS, nowMs);

    for (const userId of assigneeIds) {
      candidates.push({
        id: overdue
          ? `overdue_${issue.id}_${userId}_${dayKey}`
          : `deadline_${issue.id}_${userId}_${dayKey}`,
        userId,
        organizationId: issue.organizationId,
        projectId: issue.projectId,
        issueId: issue.id,
        issueKey: issue.issueKey || '',
        type: 'deadline',
        title: overdue
          ? `${issue.issueKey || 'Завдання'}: дедлайн прострочено${overdueDays > 0 ? ` на ${overdueDays} дн` : ''}`
          : `${issue.issueKey || 'Завдання'}: дедлайн ${dueLabel}`,
        body: issue.title || '',
        deliverAtMs,
      });
    }
  }

  return candidates;
}
