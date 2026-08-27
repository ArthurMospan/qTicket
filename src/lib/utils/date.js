import {
  DEFAULT_ORGANIZATION_TIME_ZONE,
  dayKeyInTimeZone,
  zonedDateTimeToUtcMs,
} from './timeZone.mjs';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function fromDateInput(value, { endOfDay = false, timeZone } = {}) {
  if (!value) return null;
  const match = DATE_ONLY.exec(String(value));
  if (!match) return null;
  if (timeZone) {
    const timestamp = zonedDateTimeToUtcMs(String(value), {
      hour: endOfDay ? 23 : 0,
      minute: endOfDay ? 59 : 0,
      second: endOfDay ? 59 : 0,
      millisecond: endOfDay ? 999 : 0,
    }, timeZone);
    return Number.isFinite(timestamp) ? new Date(timestamp) : null;
  }
  const [, year, month, day] = match.map(Number);
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function toLocalDateInput(value, { timeZone } = {}) {
  if (!value) return '';
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  if (timeZone) return dayKeyInTimeZone(date, timeZone);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDueDate(value, { timeZone } = {}) {
  if (!value) return null;
  if (typeof value === 'string' && DATE_ONLY.test(value)) {
    return fromDateInput(value, { endOfDay: true, timeZone });
  }
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function isDueDateOverdue(
  value,
  { now = Date.now(), timeZone = DEFAULT_ORGANIZATION_TIME_ZONE } = {},
) {
  const dueDate = parseDueDate(value, { timeZone });
  if (!dueDate) return false;
  const dueDay = dayKeyInTimeZone(dueDate, timeZone);
  const currentDay = dayKeyInTimeZone(now, timeZone);
  return Boolean(dueDay && currentDay && dueDay < currentDay);
}
