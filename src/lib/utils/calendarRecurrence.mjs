// Shared UTC recurrence maths for the calendar. The client, reminders, billing,
// and server validation MUST generate the same instant for each occurrence.
// Events currently do not store an IANA timezone, so local-time arithmetic
// would make occurrence identity depend on the machine evaluating the series.

// Advancing a monthly series with setMonth() alone drifts: 31 January + 1 month
// lands on 3 March, and every later occurrence inherits the shift. The day of
// month is anchored to the series start and clamped to the target month's
// length instead, so the 31st becomes the 28th/30th and then returns to the 31st.
export function addRecurrence(date, frequency, interval, anchorDayOfMonth = null) {
  const next = new Date(date);
  if (frequency === 'daily') {
    next.setUTCDate(next.getUTCDate() + interval);
    return next;
  }
  if (frequency === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7 * interval);
    return next;
  }
  if (frequency === 'monthly') {
    const anchorDay = anchorDayOfMonth ?? date.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + interval);
    const daysInTargetMonth = new Date(Date.UTC(
      next.getUTCFullYear(),
      next.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    next.setUTCDate(Math.min(anchorDay, daysInTargetMonth));
    return next;
  }
  return next;
}

function occurrenceAtIndex(
  seriesStart,
  frequency,
  interval,
  index,
  anchorDayOfMonth,
) {
  const occurrence = new Date(seriesStart);
  if (frequency === 'daily' || frequency === 'weekly') {
    const days = frequency === 'weekly' ? 7 : 1;
    occurrence.setUTCDate(
      occurrence.getUTCDate() + (days * interval * index),
    );
    return occurrence;
  }

  occurrence.setUTCDate(1);
  occurrence.setUTCMonth(
    seriesStart.getUTCMonth() + (interval * index),
  );
  const daysInTargetMonth = new Date(Date.UTC(
    occurrence.getUTCFullYear(),
    occurrence.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  occurrence.setUTCDate(Math.min(anchorDayOfMonth, daysInTargetMonth));
  return occurrence;
}

function occurrenceIndexNearWindow(
  seriesStart,
  windowStart,
  frequency,
  interval,
) {
  if (frequency === 'monthly') {
    const elapsedMonths = (
      (windowStart.getUTCFullYear() - seriesStart.getUTCFullYear()) * 12
      + windowStart.getUTCMonth()
      - seriesStart.getUTCMonth()
    );
    return Math.max(0, Math.floor(elapsedMonths / interval));
  }

  const intervalDays = frequency === 'weekly' ? 7 * interval : interval;
  const elapsedDays = (
    windowStart.getTime() - seriesStart.getTime()
  ) / 86_400_000;
  return Math.max(0, Math.floor(elapsedDays / intervalDays));
}

// Occurrences of a series that overlap [windowStart, windowEnd].
//
// Callers used to walk from the series start with a fixed iteration cap, which
// silently truncated long-running series: a daily event older than the cap
// simply stopped producing occurrences — no error, no reminders, nothing on the
// calendar. Here the walk is seeded near the window, so the cost depends on the
// window length rather than on how old the series is, and `truncated` reports
// the case where a window genuinely holds more occurrences than the cap.
export function expandOccurrences({
  start,
  frequency = 'none',
  interval = 1,
  until = null,
  windowStart,
  windowEnd,
  maxOccurrences = 1000,
}) {
  const seriesStart = new Date(start);
  if (!Number.isFinite(seriesStart.getTime())) return { occurrences: [], truncated: false };
  if (frequency === 'none' || !['daily', 'weekly', 'monthly'].includes(frequency)) {
    const withinWindow = seriesStart <= windowEnd && seriesStart >= windowStart;
    return { occurrences: withinWindow ? [new Date(seriesStart)] : [], truncated: false };
  }

  const step = Math.max(1, Math.floor(Number(interval) || 1));
  const limit = until && Number.isFinite(new Date(until).getTime())
    ? new Date(Math.min(new Date(until).getTime(), windowEnd.getTime()))
    : windowEnd;

  const anchorDayOfMonth = seriesStart.getUTCDate();
  let cursor = new Date(seriesStart);

  // Seed directly by occurrence index. In particular, a calendar month is not
  // 30 days: estimating a 20-year monthly series in days can jump past the
  // requested month and reject a real occurrence used by time logs/invoices.
  if (cursor < windowStart) {
    let index = occurrenceIndexNearWindow(
      seriesStart,
      windowStart,
      frequency,
      step,
    );
    cursor = occurrenceAtIndex(
      seriesStart,
      frequency,
      step,
      index,
      anchorDayOfMonth,
    );
    while (index > 0 && cursor > windowStart) {
      index -= 1;
      cursor = occurrenceAtIndex(
        seriesStart,
        frequency,
        step,
        index,
        anchorDayOfMonth,
      );
    }
    while (cursor < windowStart) {
      const next = occurrenceAtIndex(
        seriesStart,
        frequency,
        step,
        index + 1,
        anchorDayOfMonth,
      );
      if (next.getTime() <= cursor.getTime()) break;
      cursor = next;
      index += 1;
    }
  }

  const occurrences = [];
  let truncated = false;
  while (cursor <= limit) {
    if (occurrences.length >= maxOccurrences) {
      truncated = true;
      break;
    }
    if (cursor >= windowStart) occurrences.push(new Date(cursor));
    const next = addRecurrence(cursor, frequency, step, anchorDayOfMonth);
    if (next.getTime() <= cursor.getTime()) break;
    cursor = next;
  }
  return { occurrences, truncated };
}
