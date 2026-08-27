import test from 'node:test';
import assert from 'node:assert/strict';
import { addRecurrence, expandOccurrences } from '../src/lib/utils/calendarRecurrence.mjs';

// Recurrence identity is deliberately UTC until events store an IANA timezone.
const iso = date => [
  date.getUTCFullYear(),
  String(date.getUTCMonth() + 1).padStart(2, '0'),
  String(date.getUTCDate()).padStart(2, '0'),
].join('-');

test('monthly recurrence anchors the day instead of drifting', () => {
  // 31 Jan + 1 month with plain setMonth() lands on 3 March and every later
  // occurrence inherits the shift.
  let cursor = new Date('2026-01-31T09:00:00.000Z');
  const days = [];
  for (let index = 0; index < 4; index += 1) {
    cursor = addRecurrence(cursor, 'monthly', 1, 31);
    days.push(iso(cursor));
  }
  assert.deepEqual(days, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
});

test('monthly recurrence handles a leap February', () => {
  assert.equal(
    iso(addRecurrence(new Date('2028-01-31T09:00:00.000Z'), 'monthly', 1, 31)),
    '2028-02-29',
  );
});

test('a decades-old monthly series is seeded by calendar month without overshoot', () => {
  const { occurrences, truncated } = expandOccurrences({
    start: new Date('2000-01-31T09:00:00.000Z'),
    frequency: 'monthly',
    interval: 1,
    windowStart: new Date('2026-01-01T00:00:00.000Z'),
    windowEnd: new Date('2026-03-01T00:00:00.000Z'),
  });

  assert.equal(truncated, false);
  assert.deepEqual(
    occurrences.map(occurrence => occurrence.toISOString()),
    [
      '2026-01-31T09:00:00.000Z',
      '2026-02-28T09:00:00.000Z',
    ],
  );
});

test('long monthly intervals preserve their original phase near the window', () => {
  const { occurrences } = expandOccurrences({
    start: new Date('2001-01-31T09:00:00.000Z'),
    frequency: 'monthly',
    interval: 3,
    windowStart: new Date('2025-12-01T00:00:00.000Z'),
    windowEnd: new Date('2026-08-01T00:00:00.000Z'),
  });

  assert.deepEqual(
    occurrences.map(occurrence => occurrence.toISOString()),
    [
      '2026-01-31T09:00:00.000Z',
      '2026-04-30T09:00:00.000Z',
      '2026-07-31T09:00:00.000Z',
    ],
  );
});

test('a long-running daily series still produces current occurrences', () => {
  // The old fixed iteration cap gave up ~400 steps after the series start, so
  // a daily event from three years ago produced nothing at all for today.
  const start = new Date('2023-01-01T09:00:00.000Z');
  const windowStart = new Date('2026-07-25T00:00:00.000Z');
  const windowEnd = new Date('2026-07-28T00:00:00.000Z');
  const { occurrences, truncated } = expandOccurrences({
    start, frequency: 'daily', interval: 1, windowStart, windowEnd,
  });
  assert.equal(truncated, false);
  assert.deepEqual(occurrences.map(iso), ['2026-07-25', '2026-07-26', '2026-07-27']);
});

test('weekly series keep their weekday across a long gap', () => {
  const start = new Date('2024-01-03T10:00:00.000Z'); // a Wednesday
  const { occurrences } = expandOccurrences({
    start,
    frequency: 'weekly',
    interval: 1,
    windowStart: new Date('2026-07-20T00:00:00.000Z'),
    windowEnd: new Date('2026-08-03T00:00:00.000Z'),
  });
  assert.ok(occurrences.length > 0);
  for (const occurrence of occurrences) assert.equal(occurrence.getUTCDay(), 3);
});

test('the until date ends the series', () => {
  const { occurrences } = expandOccurrences({
    start: new Date('2026-07-01T09:00:00.000Z'),
    frequency: 'daily',
    interval: 1,
    until: '2026-07-03T23:59:59.999Z',
    windowStart: new Date('2026-06-01T00:00:00.000Z'),
    windowEnd: new Date('2027-01-01T00:00:00.000Z'),
  });
  assert.deepEqual(occurrences.map(iso), ['2026-07-01', '2026-07-02', '2026-07-03']);
});

test('non-repeating events yield their single start only inside the window', () => {
  const start = new Date('2026-07-25T09:00:00.000Z');
  assert.equal(expandOccurrences({
    start,
    windowStart: new Date('2026-07-24T00:00:00.000Z'),
    windowEnd: new Date('2026-07-26T00:00:00.000Z'),
  }).occurrences.length, 1);
  assert.equal(expandOccurrences({
    start,
    windowStart: new Date('2026-07-26T00:00:00.000Z'),
    windowEnd: new Date('2026-07-27T00:00:00.000Z'),
  }).occurrences.length, 0);
});

test('the occurrence cap is reported rather than silently swallowed', () => {
  const { occurrences, truncated } = expandOccurrences({
    start: new Date('2026-01-01T00:00:00.000Z'),
    frequency: 'daily',
    interval: 1,
    windowStart: new Date('2026-01-01T00:00:00.000Z'),
    windowEnd: new Date('2027-01-01T00:00:00.000Z'),
    maxOccurrences: 10,
  });
  assert.equal(occurrences.length, 10);
  assert.equal(truncated, true);
});
