function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addLocalDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function isBirthdayOnDay(event, day) {
  const start = new Date(event.startAt);
  const target = new Date(day);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(target.getTime())) return false;

  return start.getUTCFullYear() === target.getFullYear()
    && start.getUTCMonth() === target.getMonth()
    && start.getUTCDate() === target.getDate();
}

export function isCalendarEventOnDay(event, day) {
  if (event?.allDay && event?.type === 'birthday') {
    return isBirthdayOnDay(event, day);
  }

  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = addLocalDays(dayStart, 1).getTime();
  const eventStart = new Date(event?.startAt).getTime();
  const eventEnd = new Date(event?.endAt).getTime();

  if (![dayStart, dayEnd, eventStart, eventEnd].every(Number.isFinite)) return false;
  return eventStart < dayEnd && eventEnd > dayStart;
}
