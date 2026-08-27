// The window an analytics screen is actually looking at.
//
// A report shows a period. It used to *read* a history: the analytics
// subscription asked Firestore for every time log the organization had ever
// written and threw away everything outside the chosen 7/14/30/90 days in the
// browser. Tasks are a finite set — one per piece of work — but a time log is
// written every time somebody stops a timer, by every person, every day, and it
// is never deleted. After two years that is tens of thousands of documents on
// every cold open of the screen, against a daily read quota this product has
// already exhausted twice.
//
// So the period stops being a filter and becomes part of the query. These are
// the only two windows the analytics screens ask for, and they are computed
// here — in one pure module — so that the bound in the query, the range of days
// the daily totals are read over, and the predicate in the component cannot
// drift into three different answers.
//
// Windows are half-open on the right: `sinceMillis <= loggedAt < untilMillis`.

import { dayKeyInTimeZone, zonedDateTimeToUtcMs } from './timeZone.mjs';

export const DAY_MS = 86_400_000;

/** The 7/14/30/90 the period control offers, in one place. */
export const ANALYTICS_PERIOD_DAYS = [7, 14, 30, 90];

/**
 * The week or the month the timesheet is currently showing.
 *
 * This is the range «Табель» lays its grid out over, and it is the range it
 * reads. Paging back to March does not re-read everything since March: it moves
 * the window, both edges of it.
 */
export function timesheetRange(mode, anchor) {
  const base = anchor instanceof Date ? anchor : new Date(anchor);
  const at = Number.isFinite(base.getTime()) ? base : new Date();
  if (mode === 'month') {
    return {
      start: new Date(at.getFullYear(), at.getMonth(), 1),
      end: new Date(at.getFullYear(), at.getMonth() + 1, 1),
    };
  }
  const start = new Date(at);
  const weekday = start.getDay();
  start.setDate(start.getDate() - (weekday === 0 ? 6 : weekday - 1));
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

/**
 * The same trailing period, expressed as whole days in the organization's
 * timezone — which is what a daily rollup is keyed by, and what «за 30 днів»
 * has to mean if the aggregate and the records behind it are to agree.
 *
 * The screen used to read this as «the last 720 hours»: `now - 30 * 86400000`,
 * to the millisecond. That is a fine way to filter a list and a poor way to
 * label a report — the first day of the window was always a fragment of a day,
 * and which fragment depended on the minute the page was opened. Whole days in
 * the workspace's own zone is both the more honest reading and the only one a
 * per-day total can answer exactly.
 *
 * Inclusive at both ends: `startDay <= day <= endDay`, because a day key is a
 * day, not an instant.
 */
export function periodDayRange(nowMillis, periodDays, timeZone) {
  const days = Number(periodDays);
  if (!Number.isFinite(nowMillis) || !Number.isFinite(days) || days <= 0) return null;
  const endDay = dayKeyInTimeZone(new Date(nowMillis), timeZone);
  // `days` days back *including* today, so «7 днів» is a week of days and not
  // eight of them.
  const startDay = dayKeyInTimeZone(
    new Date(nowMillis - (Math.ceil(days) - 1) * DAY_MS),
    timeZone,
  );
  return {
    startDay,
    endDay,
    sinceMillis: zonedDateTimeToUtcMs(startDay, {}, timeZone),
    // Exclusive, so that a predicate over records and a range over day keys
    // select the same set.
    untilMillis: zonedDateTimeToUtcMs(endDay, {}, timeZone) + DAY_MS,
  };
}

export function timesheetTimeLogWindow(mode, anchor) {
  const { start, end } = timesheetRange(mode, anchor);
  return { sinceMillis: start.getTime(), untilMillis: end.getTime() };
}

/**
 * A member detail has two different time questions behind one route.
 * Overview/work use the trailing analytics period; Timesheet owns the week or
 * month its grid is showing. Keeping the switch here makes it impossible for
 * the child grid to page to March while the parent still queries August.
 */
export function memberAnalyticsTimeLogWindow({
  view,
  mode,
  anchor,
  nowMillis,
  periodDays,
  timeZone,
}) {
  if (view === 'timesheet') return timesheetTimeLogWindow(mode, anchor);
  return dayRangeTimeLogWindow(periodDayRange(nowMillis, periodDays, timeZone));
}

/**
 * The same period as a bound on raw records, for the readings a per-day total
 * cannot answer — «час на задачах, призначених Анні», a search, a filter by
 * priority. One definition of the period, two ways of asking it, so the fast
 * path and the exact path can never be about different fortnights.
 */
export function dayRangeTimeLogWindow(range) {
  if (!range) return null;
  return { sinceMillis: range.sinceMillis, untilMillis: range.untilMillis };
}

/**
 * A stable identity for a window, so a hook can re-subscribe when the window
 * moves and stay put when only the object identity changed.
 */
export function timeLogWindowKey(window) {
  if (!window) return 'none';
  return `${window.sinceMillis ?? ''}:${window.untilMillis ?? ''}`;
}

export function isTimeLogWindow(window) {
  return Boolean(window)
    && Number.isFinite(window.sinceMillis)
    && (window.untilMillis === null
      || window.untilMillis === undefined
      || Number.isFinite(window.untilMillis));
}
