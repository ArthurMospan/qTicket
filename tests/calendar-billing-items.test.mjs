import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarBillingItems } from '../src/lib/utils/calendarBillingItems.mjs';

test('groups event time by occurrence and keeps each member contribution', () => {
  const occurrenceStartAt = '2026-07-25T09:00:00.000Z';
  const result = buildCalendarBillingItems({
    projectId: 'project-1',
    events: [{
      id: 'event-1::occurrence',
      sourceEventId: 'event-1',
      startAt: occurrenceStartAt,
      title: 'Стратегічна сесія',
    }],
    logs: [
      {
        id: 'event-log-1',
        sourceType: 'calendar_event',
        eventId: 'event-1',
        occurrenceStartAt,
        userId: 'member-1',
        spentMinutes: 30,
      },
      {
        id: 'event-log-2',
        sourceType: 'calendar_event',
        eventId: 'event-1',
        occurrenceStartAt,
        userId: 'member-2',
        spentMinutes: 45,
      },
      {
        id: 'invalid-negative',
        sourceType: 'calendar_event',
        eventId: 'event-1',
        occurrenceStartAt,
        userId: 'member-1',
        spentMinutes: -30,
      },
    ],
  });

  assert.equal(result.billableEvents.length, 1);
  assert.equal(result.billableEvents[0].title, 'Стратегічна сесія');
  assert.deepEqual(result.billableEvents[0].assigneeIds.sort(), ['member-1', 'member-2']);
  const aggregate = result.timeLogsByItem[result.billableEvents[0].id];
  assert.equal(aggregate.totalMinutes, 75);
  assert.deepEqual(aggregate.byUser, { 'member-1': 30, 'member-2': 45 });
  assert.deepEqual(aggregate.logIds, ['event-log-1', 'event-log-2']);
});

test('does not turn ordinary task logs into duplicate account positions', () => {
  const byIssue = {
    'issue-1': { totalMinutes: 20, byUser: { 'member-1': 20 } },
  };
  const result = buildCalendarBillingItems({
    byIssue,
    logs: [{ issueId: 'issue-1', userId: 'member-1', spentMinutes: 20 }],
  });

  assert.deepEqual(result.billableEvents, []);
  assert.deepEqual(result.timeLogsByItem, byIssue);
});
