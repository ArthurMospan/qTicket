import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  POINT_EVENT_DURATION_MINUTES,
  applyCalendarEventTypeRules,
  calendarEventHasDuration,
  calendarEventInvitesOthers,
  calendarEventRequiresReminder,
  calendarEventSupportsPlace,
  calendarEventSupportsProject,
  calendarEventSupportsReminders,
  calendarEventSupportsRsvp,
  calendarEventSupportsTracking,
  calendarEventTypeLabel,
  calendarEventVisibilityOptionsFor,
  isKnownCalendarEventType,
  normalizeCalendarEventVisibility,
} from '../src/lib/utils/calendarEventTypes.mjs';
import {
  MAX_CALENDAR_REMINDERS,
  normalizeCalendarReminderMinutes,
} from '../src/lib/utils/calendarReminders.mjs';

const read = path => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('a gathering invites people and collects answers; a personal entry does neither', () => {
  for (const type of ['meeting', 'event']) {
    assert.equal(calendarEventInvitesOthers(type), true, type);
    assert.equal(calendarEventSupportsRsvp(type), true, type);
  }
  // The complaint that started this: "буду / не буду / можливо" on a reminder
  // you set for yourself.
  for (const type of ['focus', 'absence', 'reminder', 'note']) {
    assert.equal(calendarEventInvitesOthers(type), false, type);
    assert.equal(calendarEventSupportsRsvp(type), false, type);
  }
  // A release is announced to the team but is not something you attend.
  assert.equal(calendarEventInvitesOthers('release'), true);
  assert.equal(calendarEventSupportsRsvp('release'), false);
});

test('only work-shaped types carry a project, a place and tracked hours', () => {
  assert.deepEqual(
    ['meeting', 'event', 'release', 'focus', 'absence', 'reminder', 'note']
      .filter(calendarEventSupportsProject),
    ['meeting', 'event', 'release', 'focus'],
  );
  assert.deepEqual(
    ['meeting', 'event', 'release', 'focus', 'absence', 'reminder', 'note']
      .filter(calendarEventSupportsTracking),
    ['meeting', 'event', 'focus'],
  );
  assert.deepEqual(
    ['meeting', 'event', 'release', 'focus', 'absence', 'reminder', 'note']
      .filter(calendarEventSupportsPlace),
    ['meeting', 'event'],
  );
});

test('a reminder must fire and a note never does', () => {
  assert.equal(calendarEventRequiresReminder('reminder'), true);
  assert.equal(calendarEventSupportsReminders('reminder'), true);
  assert.equal(calendarEventSupportsReminders('note'), false);
  assert.equal(calendarEventRequiresReminder('meeting'), false);
});

test('a reminder with no interval chosen still fires, at its own start', () => {
  const result = applyCalendarEventTypeRules(
    { type: 'reminder', reminderMinutes: [] },
    { ownerId: 'u1' },
  );
  assert.deepEqual(result.reminderMinutes, [0]);
  // And it is addressed to its author, which is what makes the sweep deliver it.
  assert.deepEqual(result.participantIds, ['u1']);
});

test('a personal type is exactly its owner, whoever the client listed', () => {
  const result = applyCalendarEventTypeRules(
    { type: 'absence', participantIds: ['u2', 'u3'] },
    { ownerId: 'u1' },
  );
  assert.deepEqual(result.participantIds, ['u1']);
});

test('a gathering always includes its organizer, without duplicating them', () => {
  const result = applyCalendarEventTypeRules(
    { type: 'meeting', participantIds: ['u2', 'u1'] },
    { ownerId: 'u1' },
  );
  assert.deepEqual(result.participantIds, ['u1', 'u2']);
});

test('fields the type cannot hold are dropped, not merely hidden', () => {
  const result = applyCalendarEventTypeRules({
    type: 'note',
    projectId: 'p1',
    location: 'Офіс',
    meetingUrl: 'https://meet.example',
    reminderMinutes: [15],
  }, { ownerId: 'u1' });
  assert.equal(result.projectId, '');
  assert.equal(result.location, '');
  assert.equal(result.meetingUrl, '');
  assert.deepEqual(result.reminderMinutes, []);
});

test('"лише учасники" is not offered when you are the only participant', () => {
  assert.deepEqual(
    calendarEventVisibilityOptionsFor('meeting').map(option => option.value),
    ['team', 'participants', 'private'],
  );
  assert.deepEqual(
    calendarEventVisibilityOptionsFor('reminder').map(option => option.value),
    ['team', 'private'],
  );
  // A visibility the new type cannot honour falls back to that type's default.
  assert.equal(normalizeCalendarEventVisibility('reminder', 'participants'), 'private');
  assert.equal(normalizeCalendarEventVisibility('absence', 'participants'), 'team');
  assert.equal(normalizeCalendarEventVisibility('meeting', 'participants'), 'participants');
});

test('a moment on the calendar has no end to ask for', () => {
  assert.equal(calendarEventHasDuration('meeting'), true);
  assert.equal(calendarEventHasDuration('absence'), true);
  assert.equal(calendarEventHasDuration('reminder'), false);
  assert.equal(calendarEventHasDuration('note'), false);
  assert.equal(calendarEventHasDuration('release'), false);
  assert.ok(POINT_EVENT_DURATION_MINUTES > 0);
});

test('legacy and system types resolve rather than falling back to a generic label', () => {
  assert.equal(isKnownCalendarEventType('milestone'), true);
  assert.equal(calendarEventTypeLabel('milestone'), 'Реліз / етап');
  assert.equal(isKnownCalendarEventType('birthday'), true);
  assert.equal(calendarEventTypeLabel('birthday'), 'День народження');
  assert.equal(isKnownCalendarEventType('nonsense'), false);
  // A birthday is read-only: nothing about it is editable or trackable.
  assert.equal(calendarEventSupportsTracking('birthday'), false);
  assert.equal(calendarEventSupportsRsvp('birthday'), false);
  assert.equal(calendarEventSupportsReminders('birthday'), false);
});

test('the write route refuses `birthday`, which is generated on read only', async () => {
  const source = await read('../src/lib/server/calendarEvents.js');
  assert.match(source, /type === 'birthday' \|\| !isKnownCalendarEventType\(type\)/);
  // And it derives the end of a point-in-time event instead of trusting one.
  assert.match(source, /if \(!calendarEventHasDuration\(type\)\) \{/);
  assert.match(source, /applyCalendarEventTypeRules\(\{/);
});

test('calendar reminder selection has one explicit five-item limit', async () => {
  const [server, dialog, page, select] = await Promise.all([
    read('../src/lib/server/calendarEvents.js'),
    read('../src/components/workspace/calendar/CalendarEventDialog.jsx'),
    read('../src/components/workspace/calendar/CalendarEventPage.jsx'),
    read('../src/components/ui/Select.jsx'),
  ]);

  assert.equal(MAX_CALENDAR_REMINDERS, 5);
  assert.deepEqual(
    normalizeCalendarReminderMinutes([60, 5, 10, 15, 30, 5]).value,
    [5, 10, 15, 30, 60],
  );
  assert.equal(
    normalizeCalendarReminderMinutes([5, 10, 15, 30, 60, 120]).error,
    'Можна вибрати не більше п’яти нагадувань',
  );
  assert.doesNotMatch(server, /sort\(\(a, b\) => a - b\)\.slice\(0, 5\)/);
  assert.match(server, /normalizeCalendarReminderMinutes\(/);
  assert.match(dialog, /maxSelected=\{MAX_CALENDAR_REMINDERS\}/);
  assert.match(page, /maxSelected=\{MAX_CALENDAR_REMINDERS\}/);
  assert.match(select, /!isSelected && atSelectionLimit/);
  assert.match(select, /disabled=\{optionDisabled\}/);
});

test('time logging is refused for types that cannot hold hours', async () => {
  const source = await read('../src/app/api/calendar/events/[eventId]/time-logs/route.js');
  assert.match(
    source,
    /const canTrackTime = event\.visibility === 'team' && typeAllowsTracking/,
  );
  assert.match(source, /CALENDAR_TIME_TYPE_DISABLED/);
});

test('a birthday saved today is announced without waiting for the next daily claim', async () => {
  const [jobs, route] = await Promise.all([
    read('../src/lib/server/reminderJobs.js'),
    read('../src/app/api/calendar/birthday/route.js'),
  ]);
  // The claim is a cost control and must be skippable, or a birthday added
  // after the day's scheduled pass is silently lost until the next year.
  assert.match(jobs, /if \(!force\) \{/);
  assert.match(jobs, /createBirthdayNotifications\(/);
  assert.match(jobs, /`birthday_\$\{dayKey\}_\$\{birthdayUserId\}_\$\{userId\}`/);
  assert.match(route, /force: true/);
  assert.match(route, /userId: authorization\.user\.uid/);
});
