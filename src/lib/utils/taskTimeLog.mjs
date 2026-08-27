export const MAX_TASK_TIME_LOG_MINUTES = 525_600;
export const MAX_TASK_TIME_LOG_DESCRIPTION_LENGTH = 2_000;
export const MAX_TASK_TIME_LOG_ID_LENGTH = 256;
export const MAX_TASK_TIME_LOG_TIMESTAMP_LENGTH = 35;
export const TASK_TIME_LOG_MIRROR_VERSION = 1;

export const EARLIEST_TASK_TIME_LOG_MILLIS = Date.parse('2000-01-01T00:00:00.000Z');
export const LATEST_TASK_TIME_LOG_MILLIS = Date.parse('2100-01-01T00:00:00.000Z');

const RFC_3339_TIMESTAMP = (
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/
);

export function cleanTaskTimeLogId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return (
    normalized
    && normalized.length <= MAX_TASK_TIME_LOG_ID_LENGTH
    && !normalized.includes('/')
    && !normalized.includes('\0')
  )
    ? normalized
    : '';
}

export function exactTaskTimeLogMinutes(value) {
  return (
    Number.isSafeInteger(value)
    && value > 0
    && value <= MAX_TASK_TIME_LOG_MINUTES
  )
    ? value
    : null;
}

export function parseTaskTimeLogDescription(value) {
  if (value === undefined) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, value: '' };
  const normalized = value.trim();
  return normalized.length <= MAX_TASK_TIME_LOG_DESCRIPTION_LENGTH
    ? { ok: true, value: normalized }
    : { ok: false, value: '' };
}

export function parseTaskTimeLogTimestamp(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, millis: null };
  }
  if (typeof value !== 'string' || value.length > MAX_TASK_TIME_LOG_TIMESTAMP_LENGTH) {
    return { ok: false, millis: null };
  }
  const match = RFC_3339_TIMESTAMP.exec(value);
  if (!match) return { ok: false, millis: null };
  const [
    ,
    rawYear,
    rawMonth,
    rawDay,
    rawHour,
    rawMinute,
    rawSecond,
    rawZone,
  ] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = Number(rawSecond);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const zoneHour = rawZone === 'Z' ? 0 : Number(rawZone.slice(1, 3));
  const zoneMinute = rawZone === 'Z' ? 0 : Number(rawZone.slice(4, 6));
  if (
    month < 1
    || month > 12
    || day < 1
    || day > daysInMonth
    || hour > 23
    || minute > 59
    || second > 59
    || zoneHour > 23
    || zoneMinute > 59
  ) {
    return { ok: false, millis: null };
  }
  const millis = Date.parse(value);
  if (
    !Number.isFinite(millis)
    || millis < EARLIEST_TASK_TIME_LOG_MILLIS
    || millis >= LATEST_TASK_TIME_LOG_MILLIS
  ) {
    return { ok: false, millis: null };
  }
  return { ok: true, millis };
}

export function isTaskTimeLogIdentity(log, {
  issueId,
  organizationId,
  projectId,
}) {
  return Boolean(
    log
    && log.issueId === issueId
    && log.organizationId === organizationId
    && log.projectId === projectId
    && log.sourceType !== 'calendar_event'
    && !log.eventId
    && !log.occurrenceStartAt
  );
}

export function isTaskEstimateReservationIdentity(reservation, {
  issueId,
  organizationId,
  projectId,
}) {
  return Boolean(
    reservation
    && reservation.organizationId === organizationId
    && reservation.projectId === projectId
    && reservation.itemId === issueId
  );
}

export function taskTimeLogMirrorTransition({
  currentSpentMinutes,
  spentMinutesDelta,
  initialize = false,
}) {
  const current = initialize ? 0 : currentSpentMinutes;
  const next = current + spentMinutesDelta;
  if (
    !Number.isSafeInteger(current)
    || current < 0
    || !Number.isSafeInteger(spentMinutesDelta)
    || !Number.isSafeInteger(next)
    || next < 0
  ) {
    return null;
  }
  return { current, next };
}
