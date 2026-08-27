import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  fromDateInput,
  isDueDateOverdue,
  toLocalDateInput,
} from '../src/lib/utils/date.js';
import {
  dayKeyInTimeZone as reminderDayKey,
} from '../src/lib/utils/reminderCandidates.mjs';
import {
  asDate,
  dayKeyInTimeZone,
  organizationTimeZone,
} from '../src/lib/utils/timeZone.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a deadline input is stored at the organization end of day', () => {
  const newYork = fromDateInput('2026-08-13', {
    endOfDay: true,
    timeZone: 'America/New_York',
  });
  const kyiv = fromDateInput('2026-08-13', {
    endOfDay: true,
    timeZone: 'Europe/Kyiv',
  });

  assert.equal(newYork.toISOString(), '2026-08-14T03:59:59.999Z');
  assert.equal(kyiv.toISOString(), '2026-08-13T20:59:59.999Z');
});

test('all readers recover the same day through the organization timezone', () => {
  const stored = '2026-08-14T03:59:59.999Z';
  const organization = { timezone: 'America/New_York' };
  const timeZone = organizationTimeZone(organization);

  assert.equal(toLocalDateInput(stored, { timeZone }), '2026-08-13');
  // The raw instant would be the 14th in Kyiv. It is deliberately not decoded
  // in the reader's browser zone anymore.
  assert.equal(dayKeyInTimeZone(stored, 'Europe/Kyiv'), '2026-08-14');
  assert.equal(toLocalDateInput(stored, { timeZone }), '2026-08-13');
});

test('existing Kyiv end-of-day timestamps keep their calendar date', () => {
  const existing = '2026-08-13T20:59:59.999Z';
  assert.equal(
    toLocalDateInput(existing, { timeZone: 'Europe/Kyiv' }),
    '2026-08-13',
  );
});

test('overdue changes at the next organization day, not at a reader offset', () => {
  const dueDate = '2026-08-14T03:59:59.999Z';
  assert.equal(isDueDateOverdue(dueDate, {
    now: Date.parse('2026-08-14T03:30:00.000Z'),
    timeZone: 'America/New_York',
  }), false);
  assert.equal(isDueDateOverdue(dueDate, {
    now: Date.parse('2026-08-14T04:00:00.000Z'),
    timeZone: 'America/New_York',
  }), true);
});

test('the UI and reminder scheduler share one day-key implementation', () => {
  const instant = '2026-08-13T21:30:00.000Z';
  assert.equal(
    dayKeyInTimeZone(instant, 'Europe/Kyiv'),
    reminderDayKey(instant, 'Europe/Kyiv'),
  );
});

test('deadline UI routes every overdue decision through the shared helper', async () => {
  const sources = await Promise.all([
    read('../src/components/workspace/IssueCard.jsx'),
    read('../src/components/ui/TaskManagement/TaskRow.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/workspace/AnalyticsTab.jsx'),
    read('../src/components/workspace/WorkloadTab.jsx'),
    read('../src/app/(app)/analytics/page.js'),
  ]);

  for (const source of sources) {
    assert.match(source, /isDueDateOverdue/);
    assert.doesNotMatch(source, /due(?:Date)?\.getTime\(\)\s*<\s*now|due\s*<\s*new Date/);
  }
});

test('a Firestore timestamp is a date every reader can format', () => {
  // What «Архів» → «Завдання» hands over: a stored field, not a Date. It answers
  // `toDate()` and nothing else, and the screen used to throw on `getTime`.
  const stored = { toDate: () => new Date('2026-08-19T10:00:00.000Z') };

  assert.equal(asDate(stored).toISOString(), '2026-08-19T10:00:00.000Z');
  assert.equal(asDate(new Date('2026-08-19T10:00:00.000Z')).toISOString(), '2026-08-19T10:00:00.000Z');
  assert.equal(asDate('2026-08-19T10:00:00.000Z').toISOString(), '2026-08-19T10:00:00.000Z');
  assert.equal(asDate(null), null);
  assert.equal(asDate('not a date'), null);
  assert.equal(asDate({}), null);
});

test('the date formatter coerces before it calls a Date method', async () => {
  // A regression guard for the crash itself: the formatter may not take the
  // value it was handed and call `getTime` on it.
  const source = await read('../src/lib/hooks/useLocalization.js');

  assert.match(source, /import \{ asDate \} from '@\/lib\/utils\/timeZone\.mjs'/);
  assert.match(source, /const d = asDate\(date\)/);
});
