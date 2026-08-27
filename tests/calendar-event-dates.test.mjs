import test from 'node:test';
import assert from 'node:assert/strict';
import { isCalendarEventOnDay } from '../src/lib/utils/calendarEventDates.mjs';

test('shows a UTC birthday on its calendar date only', () => {
  const birthday = {
    type: 'birthday',
    allDay: true,
    startAt: '2026-08-14T00:00:00.000Z',
    endAt: '2026-08-15T00:00:00.000Z',
  };

  assert.equal(isCalendarEventOnDay(birthday, new Date(2026, 7, 14, 12)), true);
  assert.equal(isCalendarEventOnDay(birthday, new Date(2026, 7, 15, 12)), false);
});

test('keeps ordinary multi-day event overlap behavior', () => {
  const event = {
    type: 'event',
    allDay: false,
    startAt: new Date(2026, 7, 14, 22).toISOString(),
    endAt: new Date(2026, 7, 15, 2).toISOString(),
  };

  assert.equal(isCalendarEventOnDay(event, new Date(2026, 7, 14, 12)), true);
  assert.equal(isCalendarEventOnDay(event, new Date(2026, 7, 15, 12)), true);
  assert.equal(isCalendarEventOnDay(event, new Date(2026, 7, 16, 12)), false);
});
