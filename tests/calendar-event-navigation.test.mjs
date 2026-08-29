import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarEventHref,
  calendarEventOccurrenceKey,
  findCalendarEvent,
} from '../src/lib/utils/calendarEventNavigation.mjs';

test('builds a stable details URL for a recurring occurrence', () => {
  const event = {
    id: 'event-42::occurrence',
    sourceEventId: 'event-42',
    startAt: '2026-07-25T09:00:00.000Z',
  };
  assert.equal(
    calendarEventHref(event),
    '/calendar/event/event-42?occurrence=2026-07-25T09%3A00%3A00.000Z',
  );
  assert.equal(
    calendarEventOccurrenceKey('event-42', event.startAt),
    'event:event-42:2026-07-25T09:00:00.000Z',
  );
});

test('finds the requested occurrence and falls back to the event series', () => {
  const events = [
    { id: 'event-42::one', sourceEventId: 'event-42', startAt: '2026-07-25T09:00:00.000Z' },
    { id: 'event-42::two', sourceEventId: 'event-42', startAt: '2026-08-01T09:00:00.000Z' },
  ];
  assert.equal(
    findCalendarEvent(events, 'event-42', '2026-08-01T09:00:00.000Z')?.id,
    'event-42::two',
  );
  assert.equal(findCalendarEvent(events, 'event-42')?.id, 'event-42::one');
});
