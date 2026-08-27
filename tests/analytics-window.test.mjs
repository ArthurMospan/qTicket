import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ANALYTICS_PERIOD_DAYS,
  DAY_MS,
  dayRangeTimeLogWindow,
  isTimeLogWindow,
  memberAnalyticsTimeLogWindow,
  periodDayRange,
  timeLogWindowKey,
  timesheetRange,
  timesheetTimeLogWindow,
} from '../src/lib/utils/analyticsWindow.mjs';

const KYIV = 'Europe/Kyiv';

// «За 30 днів» used to mean «the last 720 hours»: `now - 30 * 86400000`, to the
// millisecond, so the first day of every window was a fragment of a day and
// which fragment depended on the minute the page was opened. A report labelled
// in days should be measured in days — and a per-day total is the only thing
// that can answer it exactly.
test('a period is whole days in the organization timezone, today included', () => {
  const now = Date.parse('2026-08-24T10:00:00.000Z');
  const week = periodDayRange(now, 7, KYIV);
  assert.equal(week.endDay, '2026-08-24');
  assert.equal(week.startDay, '2026-08-18', 'seven days, not eight');
  assert.equal(week.untilMillis - week.sinceMillis, 7 * DAY_MS);

  // The zone is the workspace's, not the reader's.
  assert.equal(periodDayRange(Date.parse('2026-08-24T22:00:00.000Z'), 7, KYIV).endDay, '2026-08-25');
  assert.equal(periodDayRange(Date.parse('2026-08-24T22:00:00.000Z'), 7, 'UTC').endDay, '2026-08-24');

  assert.equal(periodDayRange(now, 0, KYIV), null);
  assert.equal(periodDayRange(Number.NaN, 7, KYIV), null);
});

// The bound in the Firestore query and the range of day keys the totals are
// read over have to be the same stretch of time, or the fast path and the exact
// path answer about different fortnights.
test('the day range and the record window are the same period', () => {
  const now = Date.parse('2026-08-24T10:00:00.000Z');
  const range = periodDayRange(now, 30, KYIV);
  const window = dayRangeTimeLogWindow(range);

  assert.equal(window.sinceMillis, range.sinceMillis);
  assert.equal(window.untilMillis, range.untilMillis);
  assert.ok(isTimeLogWindow(window));
  // Kyiv midnight, not UTC midnight.
  assert.equal(new Date(window.sinceMillis).toISOString(), '2026-07-25T21:00:00.000Z');
  assert.equal(new Date(window.untilMillis).toISOString(), '2026-08-24T21:00:00.000Z');
  assert.equal(dayRangeTimeLogWindow(null), null);
});

// A daylight-saving change is a day that is 23 or 25 hours long. The window is
// built from day keys rather than from arithmetic on milliseconds, so it lands
// on the real boundaries either way.
test('a period spanning a clock change still starts and ends at midnight', () => {
  // Ukraine moved its clocks back on 25 October 2026.
  const range = periodDayRange(Date.parse('2026-10-27T10:00:00.000Z'), 7, KYIV);
  assert.equal(range.startDay, '2026-10-21');
  assert.equal(range.endDay, '2026-10-27');
  assert.equal(new Date(range.sinceMillis).toISOString(), '2026-10-20T21:00:00.000Z');
  assert.equal(new Date(range.untilMillis).toISOString(), '2026-10-27T22:00:00.000Z');
});

// «Табель» pages through weeks and months. Paging back has to *move* the
// window, not widen it — otherwise opening March pulls every log written since.
test('the timesheet window is the week or month on screen, and moves with it', () => {
  const inAugust = new Date(2026, 7, 24, 10, 0, 0); // Monday
  const week = timesheetTimeLogWindow('week', inAugust);
  assert.equal(week.untilMillis - week.sinceMillis, 7 * DAY_MS);
  assert.equal(new Date(week.sinceMillis).getDay(), 1, 'weeks start on Monday');

  const sunday = new Date(2026, 7, 30, 12, 0, 0);
  assert.equal(timesheetRange('week', sunday).start.getDate(), 24, 'Sunday belongs to the week before');

  const month = timesheetRange('month', inAugust);
  assert.equal(month.start.getMonth(), 7);
  assert.equal(month.end.getMonth(), 8);
  assert.equal(month.start.getDate(), 1);

  // A window in the past is bounded on both sides.
  const march = timesheetTimeLogWindow('month', new Date(2026, 2, 15));
  assert.ok(march.untilMillis < week.sinceMillis);
});

test('member analytics reads the period on overview and the visible range on timesheet', () => {
  const now = Date.parse('2026-08-24T10:00:00.000Z');
  const anchor = new Date(2026, 2, 15);
  const overview = memberAnalyticsTimeLogWindow({
    view: 'overview', mode: 'month', anchor, nowMillis: now, periodDays: 30, timeZone: KYIV,
  });
  const timesheet = memberAnalyticsTimeLogWindow({
    view: 'timesheet', mode: 'month', anchor, nowMillis: now, periodDays: 30, timeZone: KYIV,
  });

  assert.deepEqual(overview, dayRangeTimeLogWindow(periodDayRange(now, 30, KYIV)));
  assert.deepEqual(timesheet, timesheetTimeLogWindow('month', anchor));
  assert.ok(timesheet.untilMillis < overview.sinceMillis);
});

test('a window has an identity, so a moved window re-reads and a re-render does not', () => {
  const now = Date.parse('2026-08-24T10:00:00.000Z');
  const oneMinuteLater = now + 60_000;
  assert.equal(
    timeLogWindowKey(dayRangeTimeLogWindow(periodDayRange(now, 30, KYIV))),
    timeLogWindowKey(dayRangeTimeLogWindow(periodDayRange(oneMinuteLater, 30, KYIV))),
    'the clock ticking is not a new period',
  );
  assert.notEqual(
    timeLogWindowKey(dayRangeTimeLogWindow(periodDayRange(now, 30, KYIV))),
    timeLogWindowKey(dayRangeTimeLogWindow(periodDayRange(now, 7, KYIV))),
  );
  assert.equal(timeLogWindowKey(null), 'none');
  assert.equal(isTimeLogWindow(null), false);
  assert.equal(isTimeLogWindow({ untilMillis: 1 }), false);
});

test('the period control offers one set of periods', () => {
  assert.deepEqual(ANALYTICS_PERIOD_DAYS, [7, 14, 30, 90]);
});
