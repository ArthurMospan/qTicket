'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import { expandOccurrences } from '@/lib/utils/calendarRecurrence.mjs';

async function calendarRequest(path, options = {}) {
  return authenticatedRequest(path, options, 'Не вдалося оновити календар');
}

// How far around today the calendar materialises a repeating series. Anchoring
// the window on *now* rather than on the series start is what stops a
// long-running daily event from vanishing: the old code walked from the first
// occurrence and gave up after a fixed number of steps, so anything older than
// ~13 months produced no occurrences at all.
const HORIZON_BEHIND_MONTHS = 6;
const HORIZON_AHEAD_MONTHS = 24;

function expandRecurringEvents(sourceEvents) {
  const windowStart = new Date();
  windowStart.setMonth(windowStart.getMonth() - HORIZON_BEHIND_MONTHS);
  const windowEnd = new Date();
  windowEnd.setMonth(windowEnd.getMonth() + HORIZON_AHEAD_MONTHS);

  return sourceEvents.flatMap(event => {
    const frequency = event.recurrence?.frequency || 'none';
    if (frequency === 'none') return [event];
    const originalStart = new Date(event.startAt);
    const duration = new Date(event.endAt).getTime() - originalStart.getTime();
    const { occurrences } = expandOccurrences({
      start: originalStart,
      frequency,
      interval: event.recurrence?.interval,
      until: event.recurrence?.until ? `${event.recurrence.until}T23:59:59.999Z` : null,
      windowStart,
      windowEnd,
    });
    const excludedOccurrences = new Set(event.excludedOccurrenceStarts || []);
    return occurrences.filter(occurrenceStart => (
      !excludedOccurrences.has(occurrenceStart.toISOString())
    )).map((occurrenceStart, index) => {
      const startAt = occurrenceStart.toISOString();
      return {
        ...event,
        id: `${event.id}::${startAt}`,
        sourceEventId: event.id,
        seriesStartAt: event.startAt,
        seriesEndAt: event.endAt,
        recurrenceIndex: index,
        startAt,
        endAt: new Date(occurrenceStart.getTime() + duration).toISOString(),
      };
    });
  });
}

export function useCalendarEvents({ enabled = true } = {}) {
  const { activeOrgId, authLoading, orgLoading } = useAppContext();
  const [events, setEvents] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!enabled) {
      setEvents([]);
      setDeadlines([]);
      setError(null);
      setLoading(false);
      return;
    }
    if (!activeOrgId) {
      setEvents([]);
      setDeadlines([]);
      // Not asked yet is not answered with nothing: on a cold load the
      // organization arrives after the first render, and finishing here made
      // the event page announce «Подію не знайдено» before it had looked.
      setLoading(Boolean(authLoading || orgLoading));
      return;
    }
    if (!silent) {
      setLoading(true);
      setEvents([]);
      setDeadlines([]);
    }
    try {
      const result = await calendarRequest(
        `/api/calendar/events?organizationId=${encodeURIComponent(activeOrgId)}`,
      );
      setEvents(expandRecurringEvents(result.events || []));
      setDeadlines(result.deadlines || []);
      setError(null);
    } catch (requestError) {
      setError(requestError);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeOrgId, authLoading, enabled, orgLoading]);

  useEffect(() => {
    const timeoutId = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  const createEvent = useCallback(async data => {
    const result = await calendarRequest('/api/calendar/events', {
      method: 'POST',
      body: JSON.stringify({ ...data, organizationId: activeOrgId }),
    });
    await refresh({ silent: true });
    return result.event;
  }, [activeOrgId, refresh]);

  const updateEvent = useCallback(async (eventId, data, mutation = {}) => {
    const result = await calendarRequest(`/api/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...data, ...mutation }),
    });
    await refresh({ silent: true });
    return result.event;
  }, [refresh]);

  const removeEvent = useCallback(async (eventId, mutation = {}) => {
    const search = new URLSearchParams();
    if (mutation.scope) search.set('scope', mutation.scope);
    if (mutation.occurrenceStartAt) search.set('occurrence', mutation.occurrenceStartAt);
    const query = search.toString();
    await calendarRequest(`/api/calendar/events/${encodeURIComponent(eventId)}${query ? `?${query}` : ''}`, {
      method: 'DELETE',
    });
    await refresh({ silent: true });
  }, [refresh]);

  const respondToEvent = useCallback(async (eventId, response) => {
    return updateEvent(eventId, { response });
  }, [updateEvent]);

  return {
    events,
    deadlines,
    loading,
    error,
    refresh,
    createEvent,
    updateEvent,
    removeEvent,
    respondToEvent,
  };
}
