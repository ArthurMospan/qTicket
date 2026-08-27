export function calendarEventSourceId(event) {
  return event?.sourceEventId || event?.id || '';
}

export function calendarEventOccurrenceKey(eventId, occurrenceStartAt) {
  return `event:${eventId || ''}:${occurrenceStartAt || ''}`;
}

export function calendarEventHref(event) {
  const eventId = calendarEventSourceId(event);
  if (!eventId) return '/calendar';
  const occurrence = event?.startAt
    ? `?occurrence=${encodeURIComponent(event.startAt)}`
    : '';
  return `/calendar/event/${encodeURIComponent(eventId)}${occurrence}`;
}

export function findCalendarEvent(events, eventId, occurrenceStartAt = '') {
  if (!eventId) return null;
  const candidates = events.filter(event => calendarEventSourceId(event) === eventId);
  if (!candidates.length) return null;
  if (!occurrenceStartAt) return candidates[0];
  return candidates.find(event => event.startAt === occurrenceStartAt) || candidates[0];
}
