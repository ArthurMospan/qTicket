import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calendarEventSourceIdentityChanged,
  calendarTimeLogBillingDetails,
  isCanonicalCalendarOccurrence,
  isCalendarEventOccurrence,
  normalizeCalendarRecurrenceInterval,
  normalizeCalendarOccurrence,
} from '../src/lib/utils/calendarTimeLog.mjs';

const event = {
  projectId: 'project-a',
  startAt: '2026-01-31T09:00:00.000Z',
  endAt: '2026-01-31T10:00:00.000Z',
  allDay: false,
  visibility: 'team',
  recurrence: { frequency: 'monthly', interval: 1, until: '2026-05-31' },
};

test('normalizes occurrence identity to one canonical ISO value', () => {
  assert.equal(
    normalizeCalendarOccurrence('2026-07-29T12:00:00+03:00'),
    '2026-07-29T09:00:00.000Z',
  );
  assert.equal(isCanonicalCalendarOccurrence('2026-07-29T09:00:00.000Z'), true);
  assert.equal(isCanonicalCalendarOccurrence('2026-07-29T12:00:00+03:00'), false);
  assert.equal(normalizeCalendarOccurrence('not-a-date'), null);
  assert.equal(normalizeCalendarRecurrenceInterval(1.5), 1);
  assert.equal(normalizeCalendarRecurrenceInterval(99), 12);
});

test('validates one-off, interval and clamped monthly occurrences', () => {
  assert.equal(isCalendarEventOccurrence(event, '2026-02-28T09:00:00.000Z'), true);
  assert.equal(isCalendarEventOccurrence(event, '2026-03-31T09:00:00.000Z'), true);
  assert.equal(isCalendarEventOccurrence(event, '2026-03-30T09:00:00.000Z'), false);
  assert.equal(isCalendarEventOccurrence(event, '2026-06-30T09:00:00.000Z'), false);
  assert.equal(isCalendarEventOccurrence({
    ...event,
    startAt: '2026-05-01T09:00:00.000Z',
    recurrence: { frequency: 'daily', interval: 1, until: '2026-05-31' },
  }, '2026-06-01T09:00:00.000Z'), false);

  const weekly = {
    ...event,
    startAt: '2026-07-01T09:00:00.000Z',
    recurrence: { frequency: 'weekly', interval: 2, until: '' },
  };
  assert.equal(isCalendarEventOccurrence(weekly, '2026-07-15T09:00:00.000Z'), true);
  assert.equal(isCalendarEventOccurrence(weekly, '2026-07-15T10:00:00.000Z'), false);
  assert.equal(isCalendarEventOccurrence(weekly, '2026-07-08T09:00:00.000Z'), false);

  const once = { ...event, recurrence: { frequency: 'none' } };
  assert.equal(isCalendarEventOccurrence(once, event.startAt), true);
  assert.equal(isCalendarEventOccurrence(once, '2026-02-01T09:00:00.000Z'), false);
  assert.equal(isCalendarEventOccurrence({
    ...event,
    excludedOccurrenceStarts: ['2026-02-28T09:00:00.000Z'],
  }, '2026-02-28T09:00:00.000Z'), false);
});

test('validates an exact monthly billing occurrence after a decades-long gap', () => {
  assert.equal(isCalendarEventOccurrence({
    ...event,
    startAt: '2000-01-31T09:00:00.000Z',
    recurrence: { frequency: 'monthly', interval: 1, until: '' },
  }, '2026-01-31T09:00:00.000Z'), true);
});

test('detects source, recurrence and privacy identity changes', () => {
  assert.equal(calendarEventSourceIdentityChanged(event, { ...event, title: 'Renamed' }), false);
  assert.equal(calendarEventSourceIdentityChanged(event, { ...event, projectId: 'project-b' }), true);
  assert.equal(calendarEventSourceIdentityChanged(event, {
    ...event,
    recurrence: { ...event.recurrence, interval: 2 },
  }), true);
  assert.equal(calendarEventSourceIdentityChanged(event, {
    ...event,
    visibility: 'participants',
  }), true);
  assert.equal(calendarEventSourceIdentityChanged(event, { ...event, visibility: 'private' }), true);
});

test('reports billed calendar evidence without trusting one marker only', () => {
  assert.deepEqual(calendarTimeLogBillingDetails([
    { id: 'a' },
    { id: 'b', invoiceId: 'invoice-b' },
    { id: 'c', billedAt: true, invoiceId: 'invoice-a' },
  ]), {
    timeLogCount: 3,
    billedTimeLogCount: 2,
    billedTimeLogIds: ['b', 'c'],
    invoiceIds: ['invoice-a', 'invoice-b'],
  });
});
