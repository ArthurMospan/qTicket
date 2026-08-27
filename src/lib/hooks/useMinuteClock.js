'use client';

import { useEffect, useState } from 'react';

/**
 * The current time, as a value a render is allowed to depend on.
 *
 * The analytics screens ask two things of the clock: which tasks are overdue
 * *right now*, which changes minute to minute, and which days the chosen period
 * covers, which changes once. Reading `Date.now()` during render answers both
 * and is not allowed to — a render has to be reproducible — so the clock is
 * state, advanced on an interval.
 *
 * A minute is the resolution the first question deserves and far finer than the
 * second needs. That is fine as long as the second question is asked through
 * `periodDayRange`, whose answer is a pair of day keys: sixty of these ticks an
 * hour produce the same two strings, so the queries keyed on them do not move.
 */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return now;
}
