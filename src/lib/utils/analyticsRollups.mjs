// Denormalized daily totals of logged time.
//
// ── Why this exists ──────────────────────────────────────────────────────
//
// A report about a period should cost what the period costs, not what the
// workspace's whole history costs. Windowing the raw reads (see
// `analyticsWindow.mjs`) fixed the worst of it, but «за 90 днів» across a busy
// team is still thousands of documents to draw four numbers, while Firestore
// has a hard daily read cap. A day's total for a project is a single small document,
// and ninety of them is ninety reads whatever the team did in those ninety days.
//
// ── What it is not ───────────────────────────────────────────────────────
//
// It is not a source of truth. Every figure here is derived from `timeLogs`,
// which stays the record, and `scripts/backfill-analytics-rollups.mjs` can
// rebuild any of it from scratch. An aggregate with no way back is a number a
// bug corrupts permanently.
//
// It is not money. An invoice reads the exact `sourceTimeLogIds` behind each
// line and is not allowed to read a rollup — see docs/ARCHITECTURE.md →
// «Рахунки». Minutes summed per day cannot say which minutes were billed.
//
// It does not carry task counts. Tasks are a bounded collection — one document
// per piece of work — that the analytics screens already load for the boards,
// the open counts and the attention list; counting them from a rollup would buy
// nothing and would put a second writer on every status transition. Time is the
// thing that grows without limit, so time is what is rolled up.
//
// ── The shape ────────────────────────────────────────────────────────────
//
//   analyticsRollups/{organizationId}_{projectId}_{YYYY-MM-DD}
//
// One document per organization, project and day. `projectId` is `''` for
// team-calendar time that hangs off no project — the same distinction the raw
// logs and `firestore.rules` already make, because that time is organization
// analytics and can never be an invoice line.
//
// The day is the day in the *organization's* timezone. Which day a record
// belongs to is a fact about the workspace, not about whoever opens the report:
// that is already how the export buckets its rows, and reading it in the
// browser's zone would move records across midnight and make the file disagree
// with the screen above it.
//
// ── Cancelled work ───────────────────────────────────────────────────────
//
// A cancelled task leaves both the present and the past: its hours stop being
// counted (`issueCancel.mjs`). But cancelling happens *after* the hours were
// logged and already absorbed into a day's total, so the total has to be
// corrected — and a task can be un-cancelled, so the correction has to be
// reversible.
//
// It is therefore kept as its own figure rather than subtracted in place.
// `taskMinutes` stays «what was logged»; `cancelledTaskMinutes` is «how much of
// that belongs to tasks somebody has since called off», and a reader subtracts
// one from the other. Two consequences make this the right side of the trade:
// un-cancelling is symmetric instead of guesswork, and a rebuild from raw logs
// produces both numbers independently, so a mismatch is a bug that can be seen
// rather than one that hides inside a single figure.
//
// Archived tasks are deliberately *not* corrected. Putting a finished task away
// must never change what a month reports — the hours were worked and the
// timesheet, the invoice and the period totals all still say so.

import { dayKeyInTimeZone } from './timeZone.mjs';

/**
 * Bumped when the meaning of a stored field changes, so a rollup written by an
 * older deployment can be told apart from one written by this code — and so the
 * backfill can be asked to rewrite everything below the current version.
 */
export const ANALYTICS_ROLLUP_VERSION = 1;

export const ANALYTICS_ROLLUPS_COLLECTION = 'analyticsRollups';

/**
 * The document id, and the only place that knows how one is spelled.
 *
 * `_` is the separator the rest of the product already uses for composite ids
 * (`orgMemberships/{orgId}_{uid}`). The day is last and contains no separator,
 * so nothing has to parse this back apart — the fields inside the document are
 * what a reader uses.
 */
export function analyticsRollupId(organizationId, projectId, day) {
  return `${organizationId}_${projectId || ''}_${day}`;
}

/** The instant a log belongs to — the same rule `timeLogDates.mjs` reads by. */
export function timeLogInstant(log) {
  if (log?.occurrenceStartAt) {
    const occurrence = new Date(log.occurrenceStartAt);
    if (Number.isFinite(occurrence.getTime())) return occurrence;
  }
  if (log?.loggedAt?.toDate) return log.loggedAt.toDate();
  if (log?.loggedAt) {
    const logged = new Date(log.loggedAt);
    if (Number.isFinite(logged.getTime())) return logged;
  }
  return null;
}

export function analyticsRollupDay(log, timeZone) {
  const instant = timeLogInstant(log);
  return instant ? dayKeyInTimeZone(instant, timeZone) : '';
}

/** Minutes the aggregates are allowed to trust — the same gate as the invoice. */
export function rollupMinutes(value) {
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes > 0 && minutes <= 525_600
    ? minutes
    : 0;
}

export function isCalendarRollupLog(log) {
  return log?.sourceType === 'calendar_event' || Boolean(log?.eventId);
}

function emptyDelta(organizationId, projectId, day) {
  return {
    organizationId,
    projectId,
    day,
    taskMinutes: 0,
    eventMinutes: 0,
    cancelledTaskMinutes: 0,
    minutesByUser: {},
    cancelledMinutesByUser: {},
  };
}

export function rollupDeltaKey(organizationId, projectId, day) {
  return `${organizationId}\u0000${projectId || ''}\u0000${day}`;
}

/**
 * A running set of per-day changes, so that one mutation — or one backfill pass
 * over a thousand logs — becomes one write per day it touched.
 *
 * `sign` is +1 for a log arriving and -1 for one leaving. An edit is both: the
 * old shape removed and the new one added. That is the difference between a
 * delta and an increment, and it is the whole reason an edited log does not
 * drift the total by the amount it used to be.
 */
export class AnalyticsRollupDeltas {
  constructor(timeZone) {
    this.timeZone = timeZone;
    this.entries = new Map();
  }

  /**
   * Forget everything accumulated so far, keeping the timezone this files days
   * under.
   *
   * Called at the top of a transaction body, because Firestore re-runs that
   * body on contention while this accumulator lives outside it. Without the
   * reset a retried transaction adds the same minutes twice and the day is
   * permanently over — an aggregate nobody notices is wrong until somebody adds
   * up a month by hand, months later. Two people logging time in the same
   * project contend on the project document, which every time entry already
   * writes, so this is not a theoretical retry.
   */
  reset() {
    this.entries.clear();
    return this;
  }

  entry(organizationId, projectId, day) {
    const key = rollupDeltaKey(organizationId, projectId, day);
    if (!this.entries.has(key)) {
      this.entries.set(key, emptyDelta(organizationId, projectId || '', day));
    }
    return this.entries.get(key);
  }

  /**
   * @param log a `timeLogs` document's data
   * @param sign +1 when the log now counts, -1 when it no longer does
   * @param cancelled whether the task it belongs to is currently cancelled
   */
  add(log, sign, { cancelled = false } = {}) {
    const minutes = rollupMinutes(log?.spentMinutes);
    const organizationId = log?.organizationId || '';
    if (!minutes || !organizationId) return this;
    const day = analyticsRollupDay(log, this.timeZone);
    if (!day) return this;

    const entry = this.entry(organizationId, log?.projectId || '', day);
    const amount = minutes * sign;
    const userId = log?.userId || '';
    if (isCalendarRollupLog(log)) {
      entry.eventMinutes += amount;
    } else {
      entry.taskMinutes += amount;
      if (cancelled) {
        entry.cancelledTaskMinutes += amount;
        if (userId) {
          entry.cancelledMinutesByUser[userId] = (entry.cancelledMinutesByUser[userId] || 0) + amount;
        }
      }
    }
    if (userId) {
      entry.minutesByUser[userId] = (entry.minutesByUser[userId] || 0) + amount;
    }
    return this;
  }

  /**
   * Move a task's hours into or out of «cancelled» without touching what was
   * logged. This is what the cancel route applies, per day the task has hours
   * on, and un-cancelling is the same call with the opposite sign.
   */
  addCancellation(log, sign) {
    const minutes = rollupMinutes(log?.spentMinutes);
    const organizationId = log?.organizationId || '';
    if (!minutes || !organizationId || isCalendarRollupLog(log)) return this;
    const day = analyticsRollupDay(log, this.timeZone);
    if (!day) return this;

    const entry = this.entry(organizationId, log?.projectId || '', day);
    const amount = minutes * sign;
    entry.cancelledTaskMinutes += amount;
    if (log?.userId) {
      entry.cancelledMinutesByUser[log.userId] = (entry.cancelledMinutesByUser[log.userId] || 0) + amount;
    }
    return this;
  }

  /** Only the days that actually moved. A zero delta is not a write. */
  changed() {
    return [...this.entries.values()].filter(entry => (
      entry.taskMinutes !== 0
      || entry.eventMinutes !== 0
      || entry.cancelledTaskMinutes !== 0
      || Object.values(entry.minutesByUser).some(value => value !== 0)
      || Object.values(entry.cancelledMinutesByUser).some(value => value !== 0)
    ));
  }

  get size() {
    return this.entries.size;
  }
}

/**
 * The absolute totals for one day, rebuilt from raw logs. The backfill writes
 * these; nothing on the mutation paths does, because a full total is exactly
 * what a concurrent write would clobber.
 */
export function rebuildRollupTotals({ organizationId, projectId, day, logs, cancelledIssueIds }) {
  const totals = emptyDelta(organizationId, projectId || '', day);
  const cancelled = cancelledIssueIds instanceof Set
    ? cancelledIssueIds
    : new Set(cancelledIssueIds || []);
  for (const log of logs) {
    const minutes = rollupMinutes(log?.spentMinutes);
    if (!minutes) continue;
    const userId = log?.userId || '';
    if (isCalendarRollupLog(log)) {
      totals.eventMinutes += minutes;
    } else {
      totals.taskMinutes += minutes;
      if (log?.issueId && cancelled.has(log.issueId)) {
        totals.cancelledTaskMinutes += minutes;
        if (userId) {
          totals.cancelledMinutesByUser[userId] = (totals.cancelledMinutesByUser[userId] || 0) + minutes;
        }
      }
    }
    if (userId) {
      totals.minutesByUser[userId] = (totals.minutesByUser[userId] || 0) + minutes;
    }
  }
  return totals;
}

/** What a reader actually wants: hours that still count. */
export function countedTaskMinutes(rollup) {
  return Math.max(
    0,
    (Number(rollup?.taskMinutes) || 0) - (Number(rollup?.cancelledTaskMinutes) || 0),
  );
}

export function countedMinutesByUser(rollup) {
  const logged = rollup?.minutesByUser || {};
  const cancelled = rollup?.cancelledMinutesByUser || {};
  const result = {};
  for (const [userId, minutes] of Object.entries(logged)) {
    const counted = (Number(minutes) || 0) - (Number(cancelled[userId]) || 0);
    if (counted > 0) result[userId] = counted;
  }
  return result;
}

/**
 * The exact-record equivalent of `summarizeRollups`.
 *
 * A task-scoped filter cannot be answered by a daily total, so «Огляд» opens
 * the bounded raw records instead. The result deliberately has the same core
 * shape as the rollup summary: switching from the fast path to the exact path
 * must not change what `taskMinutes`, `eventMinutes` or `totalMinutes` mean.
 */
export function summarizeRawTimeLogs(logs, { projectIds = null } = {}) {
  const wanted = projectIds && projectIds.length ? new Set(projectIds) : null;
  const summary = {
    taskMinutes: 0,
    eventMinutes: 0,
    totalMinutes: 0,
    minutesByProject: {},
    minutesByUser: {},
  };

  for (const log of logs || []) {
    const projectId = log?.projectId || '';
    if (wanted && !wanted.has(projectId)) continue;
    const minutes = rollupMinutes(log?.spentMinutes);
    if (!minutes) continue;

    if (isCalendarRollupLog(log)) summary.eventMinutes += minutes;
    else summary.taskMinutes += minutes;
    summary.totalMinutes += minutes;
    summary.minutesByProject[projectId] = (summary.minutesByProject[projectId] || 0) + minutes;
    if (log?.userId) {
      summary.minutesByUser[log.userId] = (summary.minutesByUser[log.userId] || 0) + minutes;
    }
  }

  return summary;
}

/**
 * What a period's worth of daily documents adds up to.
 *
 * The one arithmetic the reading side needs, in one place, so that a tile, a
 * table row and an exported file cannot each sum the same days their own way.
 * `projectIds` narrows to a selection; leaving it out means every project the
 * rollups were read for.
 */
export function summarizeRollups(rollups, { projectIds = null } = {}) {
  const wanted = projectIds && projectIds.length ? new Set(projectIds) : null;
  const summary = {
    taskMinutes: 0,
    eventMinutes: 0,
    totalMinutes: 0,
    minutesByProject: {},
    minutesByUser: {},
    // The last day each person put hours against something. «Востаннє активний»
    // is drawn at day resolution — «3 дні тому» — so a day is all the precision
    // that reading ever had, and it is precision a daily total can give.
    lastLoggedDayByUser: {},
    days: 0,
  };
  for (const rollup of rollups || []) {
    const projectId = rollup?.projectId || '';
    // Team calendar time hangs off no project. A project selection is a
    // question about projects, so it excludes that time rather than silently
    // folding it into whichever project is on screen.
    if (wanted && !wanted.has(projectId)) continue;
    const taskMinutes = countedTaskMinutes(rollup);
    const eventMinutes = Number(rollup?.eventMinutes) || 0;
    summary.taskMinutes += taskMinutes;
    summary.eventMinutes += eventMinutes;
    summary.totalMinutes += taskMinutes + eventMinutes;
    summary.minutesByProject[projectId] = (summary.minutesByProject[projectId] || 0)
      + taskMinutes + eventMinutes;
    for (const [userId, minutes] of Object.entries(countedMinutesByUser(rollup))) {
      summary.minutesByUser[userId] = (summary.minutesByUser[userId] || 0) + minutes;
      const day = rollup?.day || '';
      if (day > (summary.lastLoggedDayByUser[userId] || '')) {
        summary.lastLoggedDayByUser[userId] = day;
      }
    }
    summary.days += 1;
  }
  return summary;
}

/** Two rollups of the same day are equal when every figure in them is. */
export function rollupTotalsMatch(left, right) {
  const numbers = ['taskMinutes', 'eventMinutes', 'cancelledTaskMinutes'];
  for (const field of numbers) {
    if ((Number(left?.[field]) || 0) !== (Number(right?.[field]) || 0)) return false;
  }
  for (const field of ['minutesByUser', 'cancelledMinutesByUser']) {
    const a = left?.[field] || {};
    const b = right?.[field] || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if ((Number(a[key]) || 0) !== (Number(b[key]) || 0)) return false;
    }
  }
  return true;
}
