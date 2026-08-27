export function isCalendarEventTimeLog(log) {
  return log?.sourceType === 'calendar_event' || Boolean(log?.eventId);
}

export function effectiveTimeLogDate(log) {
  if (isCalendarEventTimeLog(log) && log?.occurrenceStartAt) {
    const occurrenceDate = new Date(log.occurrenceStartAt);
    if (Number.isFinite(occurrenceDate.getTime())) return occurrenceDate;
  }
  if (log?.loggedAt?.toDate) return log.loggedAt.toDate();
  if (log?.loggedAt) {
    const loggedDate = new Date(log.loggedAt);
    if (Number.isFinite(loggedDate.getTime())) return loggedDate;
  }
  return null;
}

export function effectiveTimeLogMillis(log) {
  return effectiveTimeLogDate(log)?.getTime() ?? 0;
}
