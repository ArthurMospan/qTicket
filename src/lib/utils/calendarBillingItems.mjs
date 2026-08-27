import { calendarEventOccurrenceKey } from './calendarEventNavigation.mjs';
import { isCalendarEventTimeLog } from './timeLogDates.mjs';

function rawMinutes(value) {
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : 0;
}

export function buildCalendarBillingItems({
  logs = [],
  events = [],
  projectId = '',
  byIssue = {},
} = {}) {
  const eventMap = new Map();
  events.forEach(event => {
    eventMap.set(
      calendarEventOccurrenceKey(event.sourceEventId || event.id, event.startAt),
      event,
    );
  });

  const itemMap = {};
  const timeLogsByItem = { ...byIssue };
  const seenLogIds = new Set();
  logs.filter(isCalendarEventTimeLog).forEach(log => {
    const minutes = rawMinutes(log.spentMinutes);
    if (minutes === 0 || minutes > 525_600) return;
    if (log.id && seenLogIds.has(log.id)) return;
    if (log.id) seenLogIds.add(log.id);
    const occurrenceKey = calendarEventOccurrenceKey(log.eventId, log.occurrenceStartAt);
    const itemId = `billing:${occurrenceKey}`;
    if (!timeLogsByItem[itemId]) {
      timeLogsByItem[itemId] = { totalMinutes: 0, byUser: {}, logIds: [] };
    }
    timeLogsByItem[itemId].totalMinutes += minutes;
    if (log.userId) {
      timeLogsByItem[itemId].byUser[log.userId] = (
        timeLogsByItem[itemId].byUser[log.userId] || 0
      ) + minutes;
    }
    if (log.id) timeLogsByItem[itemId].logIds.push(log.id);

    const event = eventMap.get(occurrenceKey);
    const eventDateValue = log.occurrenceStartAt
      ? new Date(log.occurrenceStartAt)
      : null;
    const eventDate = Number.isFinite(eventDateValue?.getTime())
      ? eventDateValue.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })
      : '';
    itemMap[itemId] = {
      id: itemId,
      issueKey: eventDate ? `ПОДІЯ · ${eventDate}` : 'ПОДІЯ',
      title: event?.title || log.description || 'Подія календаря',
      type: 'calendar_event',
      columnId: 'calendar_event',
      projectId,
      assigneeIds: [...new Set([
        ...(itemMap[itemId]?.assigneeIds || []),
        ...(log.userId ? [log.userId] : []),
      ])],
    };
  });

  return {
    billableEvents: Object.values(itemMap),
    timeLogsByItem,
  };
}
