export const DEFAULT_ORGANIZATION_TIME_ZONE = 'Europe/Kyiv';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Anything a date can arrive as, as a `Date` — or `null` when it is not one.
 *
 * A Firestore `Timestamp` is not a `Date` and has no `getTime`, so every reader
 * that takes a stored field and calls a `Date` method on it directly throws.
 * That is not a hypothetical: «Архів» → «Завдання» handed `archivedAt` straight
 * to the date formatter and took the whole settings screen down with
 * `getTime is not a function`. One coercion, exported, so a reader never has to
 * know which of the three shapes it was handed.
 */
export function asDate(value) {
  if (!value) return null;
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function normalizeTimeZone(value, fallback = DEFAULT_ORGANIZATION_TIME_ZONE) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return fallback;
  try {
    new Intl.DateTimeFormat('en', { timeZone: candidate }).format(0);
    return candidate;
  } catch {
    return fallback;
  }
}

export function organizationTimeZone(organization) {
  return normalizeTimeZone(organization?.timezone);
}

export function dayKeyInTimeZone(value, timeZone = DEFAULT_ORGANIZATION_TIME_ZONE) {
  const date = asDate(value);
  if (!date) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: normalizeTimeZone(timeZone),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(
      parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]),
    );
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function zonedParts(value, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimeZone(timeZone),
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(value))
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
}

// Resolve a wall-clock value in an IANA timezone to one absolute instant.
// Date inputs carry a calendar day, not the browser author's UTC offset; this
// conversion is what lets every member save and read that day identically.
export function zonedDateTimeToUtcMs(
  dayKey,
  {
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0,
  } = {},
  timeZone = DEFAULT_ORGANIZATION_TIME_ZONE,
) {
  const match = DATE_ONLY.exec(String(dayKey || ''));
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const desiredDate = new Date(desired);
  if (
    desiredDate.getUTCFullYear() !== year
    || desiredDate.getUTCMonth() !== month - 1
    || desiredDate.getUTCDate() !== day
  ) return NaN;

  try {
    let candidate = desired;
    // The first pass discovers the zone offset. The second handles dates where
    // the initial UTC guess and the resolved local instant sit across a DST
    // boundary. A third is cheap and makes the convergence explicit.
    for (let pass = 0; pass < 3; pass += 1) {
      const parts = zonedParts(candidate, timeZone);
      const represented = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour % 24,
        parts.minute,
        parts.second,
        millisecond,
      );
      const difference = represented - desired;
      if (difference === 0) return candidate;
      candidate -= difference;
    }
    const parts = zonedParts(candidate, timeZone);
    return parts.year === year
      && parts.month === month
      && parts.day === day
      && parts.hour % 24 === hour
      && parts.minute === minute
      && parts.second === second
      ? candidate
      : NaN;
  } catch {
    return NaN;
  }
}
