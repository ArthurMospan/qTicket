import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EARLIEST_TASK_TIME_LOG_MILLIS,
  LATEST_TASK_TIME_LOG_MILLIS,
  MAX_TASK_TIME_LOG_DESCRIPTION_LENGTH,
  MAX_TASK_TIME_LOG_MINUTES,
  cleanTaskTimeLogId,
  exactTaskTimeLogMinutes,
  isTaskEstimateReservationIdentity,
  isTaskTimeLogIdentity,
  parseTaskTimeLogDescription,
  parseTaskTimeLogTimestamp,
  taskTimeLogMirrorTransition,
} from '../src/lib/utils/taskTimeLog.mjs';

test('task time-log ids are trimmed, bounded, and path-safe', () => {
  assert.equal(cleanTaskTimeLogId(' issue-a '), 'issue-a');
  assert.equal(cleanTaskTimeLogId(''), '');
  assert.equal(cleanTaskTimeLogId('bad/id'), '');
  assert.equal(cleanTaskTimeLogId('bad\0id'), '');
  assert.equal(cleanTaskTimeLogId('x'.repeat(257)), '');
  assert.equal(cleanTaskTimeLogId(123), '');
});

test('task time-log minutes require an exact safe integer in range', () => {
  assert.equal(exactTaskTimeLogMinutes(1), 1);
  assert.equal(
    exactTaskTimeLogMinutes(MAX_TASK_TIME_LOG_MINUTES),
    MAX_TASK_TIME_LOG_MINUTES,
  );
  for (const invalid of [
    0,
    -1,
    1.5,
    MAX_TASK_TIME_LOG_MINUTES + 1,
    Number.MAX_SAFE_INTEGER + 1,
    '15',
    null,
  ]) {
    assert.equal(exactTaskTimeLogMinutes(invalid), null);
  }
});

test('task time-log descriptions are trimmed and rejected above the bound', () => {
  assert.deepEqual(
    parseTaskTimeLogDescription(undefined),
    { ok: true, value: '' },
  );
  assert.deepEqual(
    parseTaskTimeLogDescription('  виконано  '),
    { ok: true, value: 'виконано' },
  );
  assert.equal(
    parseTaskTimeLogDescription('x'.repeat(MAX_TASK_TIME_LOG_DESCRIPTION_LENGTH)).ok,
    true,
  );
  assert.equal(
    parseTaskTimeLogDescription(
      'x'.repeat(MAX_TASK_TIME_LOG_DESCRIPTION_LENGTH + 1),
    ).ok,
    false,
  );
  assert.equal(parseTaskTimeLogDescription({ text: 'no' }).ok, false);
});

test('task time-log timestamps require valid bounded RFC 3339 values', () => {
  assert.deepEqual(
    parseTaskTimeLogTimestamp(undefined),
    { ok: true, millis: null },
  );
  assert.deepEqual(
    parseTaskTimeLogTimestamp(null),
    { ok: true, millis: null },
  );
  assert.equal(
    parseTaskTimeLogTimestamp('2026-07-29T12:00:00.000Z').ok,
    true,
  );
  assert.equal(
    parseTaskTimeLogTimestamp('2026-07-29T14:00:00+02:00').millis,
    Date.parse('2026-07-29T12:00:00.000Z'),
  );
  for (const invalid of [
    '2026-07-29',
    '2026-02-29T12:00:00.000Z',
    '2026-07-29T25:00:00.000Z',
    'not-a-date',
    new Date(),
    new Date(EARLIEST_TASK_TIME_LOG_MILLIS - 1).toISOString(),
    new Date(LATEST_TASK_TIME_LOG_MILLIS).toISOString(),
  ]) {
    assert.equal(parseTaskTimeLogTimestamp(invalid).ok, false);
  }
});

test('task log identity excludes calendar and cross-scope records', () => {
  const scope = {
    issueId: 'issue-a',
    organizationId: 'org-a',
    projectId: 'project-a',
  };
  const log = {
    ...scope,
    userId: 'member-a',
    spentMinutes: 15,
  };
  assert.equal(isTaskTimeLogIdentity(log, scope), true);
  assert.equal(isTaskTimeLogIdentity({ ...log, projectId: 'other' }, scope), false);
  assert.equal(
    isTaskTimeLogIdentity({ ...log, sourceType: 'calendar_event' }, scope),
    false,
  );
  assert.equal(isTaskTimeLogIdentity({ ...log, eventId: 'event-a' }, scope), false);
  assert.equal(
    isTaskTimeLogIdentity({ ...log, occurrenceStartAt: '2026-07-29T12:00:00.000Z' }, scope),
    false,
  );
});

test('estimate reservation identity requires the exact task accounting scope', () => {
  const scope = {
    issueId: 'issue-a',
    organizationId: 'org-a',
    projectId: 'project-a',
  };
  const reservation = {
    organizationId: 'org-a',
    projectId: 'project-a',
    itemId: 'issue-a',
    invoiceId: 'invoice-a',
  };

  assert.equal(isTaskEstimateReservationIdentity(reservation, scope), true);
  assert.equal(
    isTaskEstimateReservationIdentity(
      { ...reservation, organizationId: 'org-b' },
      scope,
    ),
    false,
  );
  assert.equal(
    isTaskEstimateReservationIdentity(
      { ...reservation, projectId: 'project-b' },
      scope,
    ),
    false,
  );
  assert.equal(
    isTaskEstimateReservationIdentity(
      { ...reservation, itemId: 'issue-b' },
      scope,
    ),
    false,
  );
  assert.equal(isTaskEstimateReservationIdentity(null, scope), false);
});

test('mirror transitions use a live safe integer and fail closed on drift', () => {
  assert.deepEqual(taskTimeLogMirrorTransition({
    currentSpentMinutes: 30,
    spentMinutesDelta: 15,
  }), { current: 30, next: 45 });
  assert.deepEqual(taskTimeLogMirrorTransition({
    currentSpentMinutes: 999,
    spentMinutesDelta: 15,
    initialize: true,
  }), { current: 0, next: 15 });
  assert.equal(taskTimeLogMirrorTransition({
    currentSpentMinutes: 5,
    spentMinutesDelta: -10,
  }), null);
  assert.equal(taskTimeLogMirrorTransition({
    currentSpentMinutes: undefined,
    spentMinutesDelta: 10,
  }), null);
  assert.equal(taskTimeLogMirrorTransition({
    currentSpentMinutes: 10,
    spentMinutesDelta: 1.5,
  }), null);
});
