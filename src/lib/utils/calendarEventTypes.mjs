// src/lib/utils/calendarEventTypes.mjs
// What each kind of calendar entry actually is, and therefore which fields it
// may carry. Pure and dependency-free: the create dialog, the event page, the
// write route and the time-log route all have to agree, and before this module
// they did not. Every type was drawn with the same form — a reminder to yourself
// asked who else was invited and whether they would attend, a note offered time
// tracking, an absence could be billed to a project — and the answer to "can
// this event have X?" lived in a different hardcoded list in each file.
//
// One table decides it here; the server enforces it on write, so a client that
// sends a field the type does not support simply loses it.

// A type without its own duration is a moment, not a span. It still needs an
// `endAt` to satisfy the range invariant, so it gets the shortest one that
// renders sensibly in the week grid.
export const POINT_EVENT_DURATION_MINUTES = 15;

// `audience`
//   'invite' — other people are asked to come, and are notified.
//   'self'   — it belongs to one person's own day. Nobody else is a participant,
//              so nobody is invited and there is nothing to respond to.
// `reminders`
//   'optional' — you may add them.
//   'required' — the type exists to fire one; an empty list is meaningless.
//   'none'     — the type is a passive marker and never notifies.
const TYPES = {
  meeting: {
    label: 'Мітинг',
    audience: 'invite',
    rsvp: true,
    project: true,
    tracking: true,
    place: true,
    reminders: 'optional',
    duration: true,
    defaultVisibility: 'team',
  },
  event: {
    label: 'Подія',
    audience: 'invite',
    rsvp: true,
    project: true,
    tracking: true,
    place: true,
    reminders: 'optional',
    duration: true,
    defaultVisibility: 'team',
  },
  // A milestone is announced, not attended: there is nothing to accept or
  // decline, and no hours are spent "in" it.
  release: {
    label: 'Реліз / етап',
    audience: 'invite',
    rsvp: false,
    project: true,
    tracking: false,
    place: false,
    reminders: 'optional',
    duration: false,
    defaultVisibility: 'team',
  },
  // Your own deep-work block. The team can see it so they know not to interrupt,
  // but they are not invited to it — and the hours are real project hours.
  focus: {
    label: 'Фокус-час',
    audience: 'self',
    rsvp: false,
    project: true,
    tracking: true,
    place: false,
    reminders: 'optional',
    duration: true,
    defaultVisibility: 'team',
  },
  absence: {
    label: 'Відсутність',
    audience: 'self',
    rsvp: false,
    project: false,
    tracking: false,
    place: false,
    reminders: 'optional',
    duration: true,
    defaultVisibility: 'team',
  },
  reminder: {
    label: 'Нагадування',
    audience: 'self',
    rsvp: false,
    project: false,
    tracking: false,
    place: false,
    reminders: 'required',
    duration: false,
    defaultVisibility: 'private',
  },
  note: {
    label: 'Нотатка',
    audience: 'self',
    rsvp: false,
    project: false,
    tracking: false,
    place: false,
    reminders: 'none',
    duration: false,
    defaultVisibility: 'private',
  },
};

// Generated from member profiles on read; never stored, never editable.
const BIRTHDAY = {
  label: 'День народження',
  audience: 'self',
  rsvp: false,
  project: false,
  tracking: false,
  place: false,
  reminders: 'none',
  duration: true,
  defaultVisibility: 'team',
  system: true,
};

// `milestone` predates `release` and still exists in stored data.
const ALIASES = { milestone: 'release' };

export const CALENDAR_EVENT_TYPE_ORDER = Object.keys(TYPES);
export const CALENDAR_EVENT_TYPE_LABELS = new Map([
  ...Object.entries(TYPES).map(([value, type]) => [value, type.label]),
  ['birthday', BIRTHDAY.label],
]);

export function calendarEventTypeCapabilities(type) {
  if (type === 'birthday') return BIRTHDAY;
  return TYPES[ALIASES[type] || type] || TYPES.meeting;
}

export function isKnownCalendarEventType(type) {
  return type === 'birthday' || Boolean(TYPES[ALIASES[type] || type]);
}

// Resolves through the alias table, so a stored `milestone` reads as "Реліз /
// етап" rather than falling back to the generic label.
export function calendarEventTypeLabel(type) {
  if (!isKnownCalendarEventType(type)) return TYPES.event.label;
  return calendarEventTypeCapabilities(type).label;
}

// Does this type invite other people, or is it one person's own entry?
export function calendarEventInvitesOthers(type) {
  return calendarEventTypeCapabilities(type).audience === 'invite';
}

export function calendarEventSupportsRsvp(type) {
  const capabilities = calendarEventTypeCapabilities(type);
  return capabilities.audience === 'invite' && capabilities.rsvp === true;
}

export function calendarEventSupportsProject(type) {
  return calendarEventTypeCapabilities(type).project === true;
}

export function calendarEventSupportsTracking(type) {
  return calendarEventTypeCapabilities(type).tracking === true;
}

export function calendarEventSupportsPlace(type) {
  return calendarEventTypeCapabilities(type).place === true;
}

export function calendarEventSupportsReminders(type) {
  return calendarEventTypeCapabilities(type).reminders !== 'none';
}

export function calendarEventRequiresReminder(type) {
  return calendarEventTypeCapabilities(type).reminders === 'required';
}

export function calendarEventHasDuration(type) {
  return calendarEventTypeCapabilities(type).duration === true;
}

export function calendarEventDefaultVisibility(type) {
  return calendarEventTypeCapabilities(type).defaultVisibility || 'team';
}

// The one place that answers "what does this event look like once its type has
// had its say?". Callers pass whatever the form or the request holds; what comes
// back is the same shape with every unsupported field emptied.
//
// `ownerId` is the person the event belongs to — the organizer. A self-audience
// type always ends up with exactly that one participant, which is what makes its
// reminders fire for its author and its invitations never be sent.
export function applyCalendarEventTypeRules(value, { ownerId = '' } = {}) {
  const type = isKnownCalendarEventType(value?.type) ? value.type : 'meeting';
  const capabilities = calendarEventTypeCapabilities(type);
  const next = { ...value, type };

  if (capabilities.audience === 'self') {
    next.participantIds = ownerId ? [ownerId] : [];
  } else {
    const participants = Array.isArray(next.participantIds) ? next.participantIds : [];
    next.participantIds = [...new Set(
      ownerId ? [ownerId, ...participants] : participants,
    )];
  }

  if (!capabilities.project) next.projectId = '';
  if (!capabilities.place) {
    next.location = '';
    next.meetingUrl = '';
  }

  const reminders = Array.isArray(next.reminderMinutes) ? next.reminderMinutes : [];
  if (capabilities.reminders === 'none') next.reminderMinutes = [];
  else if (capabilities.reminders === 'required' && !reminders.length) next.reminderMinutes = [0];
  else next.reminderMinutes = reminders;

  return next;
}

// A visibility the type can actually honour. A self-audience entry may still be
// visible to the team (an absence is announced, a focus block is a "do not
// disturb"), but "лише учасники" collapses to "лише я" when you are the only
// participant, so it is not offered.
export function calendarEventVisibilityOptionsFor(type) {
  const options = [
    { value: 'team', label: 'Уся команда' },
    { value: 'participants', label: 'Лише учасники' },
    { value: 'private', label: 'Лише я' },
  ];
  if (calendarEventInvitesOthers(type)) return options;
  return options.filter(option => option.value !== 'participants');
}

export function normalizeCalendarEventVisibility(type, visibility) {
  const allowed = calendarEventVisibilityOptionsFor(type).map(option => option.value);
  if (allowed.includes(visibility)) return visibility;
  return calendarEventDefaultVisibility(type);
}
