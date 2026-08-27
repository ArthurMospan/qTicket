'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import { reportLoadError } from '@/lib/utils/errors';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';

async function calendarTimeLogRequest(path, options = {}) {
  return authenticatedRequest(path, options, 'Не вдалося оновити зафіксований час');
}

function requestPath({
  activeOrgId,
  eventId,
  occurrenceStartAt,
  projectId,
  logId,
}) {
  const params = new URLSearchParams({
    organizationId: activeOrgId,
    occurrenceStartAt,
    projectId: projectId || '',
  });
  if (logId) params.set('logId', logId);
  return `/api/calendar/events/${encodeURIComponent(eventId)}/time-logs?${params}`;
}

export function useCalendarEventTimeLogs(eventId, occurrenceStartAt, projectId) {
  const { activeOrgId } = useAppContext();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(Boolean(eventId));
  const [canTrackTime, setCanTrackTime] = useState(false);
  const [trackingDisabledReason, setTrackingDisabledReason] = useState(null);

  const refresh = useCallback(async ({ signal } = {}) => {
    if (!eventId || !occurrenceStartAt || !activeOrgId) {
      setLogs([]);
      setCanTrackTime(false);
      setTrackingDisabledReason(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await calendarTimeLogRequest(requestPath({
        activeOrgId,
        eventId,
        occurrenceStartAt,
        projectId,
      }), { signal });
      setLogs(result.logs || []);
      setCanTrackTime(result.canTrackTime === true);
      setTrackingDisabledReason(result.trackingDisabledReason || null);
    } catch (error) {
      if (error.name !== 'AbortError') {
        reportLoadError('[useCalendarEventTimeLogs]', error);
        setLogs([]);
        setCanTrackTime(false);
        setTrackingDisabledReason(error.code || 'unavailable');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeOrgId, eventId, occurrenceStartAt, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      refresh({ signal: controller.signal });
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [refresh]);

  const addTimeLog = useCallback(async ({
    userId,
    spentMinutes,
    description = '',
    timerSessionId,
  }) => {
    const minutes = Number(spentMinutes);
    if (
      !eventId
      || !occurrenceStartAt
      || !userId
      || !Number.isSafeInteger(minutes)
      || minutes <= 0
      || minutes > 525_600
    ) {
      throw new Error('Вкажіть коректний час');
    }
    await calendarTimeLogRequest(
      `/api/calendar/events/${encodeURIComponent(eventId)}/time-logs`,
      {
        method: 'POST',
        body: JSON.stringify({
          organizationId: activeOrgId,
          projectId: projectId || '',
          occurrenceStartAt,
          userId,
          spentMinutes: minutes,
          description,
          ...(timerSessionId ? { timerSessionId } : {}),
        }),
      },
    );
    await refresh();
  }, [activeOrgId, eventId, occurrenceStartAt, projectId, refresh]);

  const deleteTimeLog = useCallback(async logId => {
    const current = logs.find(log => log.id === logId);
    if (current?.invoiceId || current?.billedAt) {
      throw new Error('Цей запис часу вже входить у рахунок і не може бути видалений');
    }
    await calendarTimeLogRequest(requestPath({
      activeOrgId,
      eventId,
      occurrenceStartAt,
      projectId,
      logId,
    }), { method: 'DELETE' });
    await refresh();
  }, [activeOrgId, eventId, logs, occurrenceStartAt, projectId, refresh]);

  const updateTimeLog = useCallback(async (logId, {
    spentMinutes,
    description = '',
  }) => {
    const minutes = Number(spentMinutes);
    const current = logs.find(log => log.id === logId);
    if (current?.invoiceId || current?.billedAt) {
      throw new Error('Цей запис часу вже входить у рахунок і не може бути змінений');
    }
    if (
      !logId
      || !Number.isSafeInteger(minutes)
      || minutes <= 0
      || minutes > 525_600
    ) {
      throw new Error('Вкажіть коректний час');
    }
    await calendarTimeLogRequest(
      `/api/calendar/events/${encodeURIComponent(eventId)}/time-logs`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          organizationId: activeOrgId,
          projectId: projectId || '',
          occurrenceStartAt,
          logId,
          spentMinutes: minutes,
          description,
        }),
      },
    );
    await refresh();
  }, [activeOrgId, eventId, logs, occurrenceStartAt, projectId, refresh]);

  return {
    logs,
    loading,
    canTrackTime,
    trackingDisabledReason,
    totalMinutes: logs.reduce(
      (sum, log) => sum + (Number(log.spentMinutes) || 0),
      0,
    ),
    addTimeLog,
    updateTimeLog,
    deleteTimeLog,
    refresh,
  };
}
