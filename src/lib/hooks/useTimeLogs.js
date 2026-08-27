'use client';

// Realtime task time-log reads plus server-authoritative mutations.
import { useCallback, useEffect, useState } from 'react';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import {
  createTaskTimeLogViaApi,
  deleteTaskTimeLogViaApi,
  updateTaskTimeLogViaApi,
} from '@/lib/services/timeLogs';
import { reportLoadError } from '@/lib/utils/errors';
import { liveDocumentData } from '@/lib/utils/firestoreDocument.mjs';

export function useTimeLogs(issueId, projectId) {
  const { activeOrgId } = useAppContext();
  const [logs, setLogs] = useState([]);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLogs([]);
      setTotalMinutes(0);
      setLoading(Boolean(issueId && projectId && activeOrgId));
    });

    if (!issueId || !projectId || !activeOrgId) {
      return () => {
        cancelled = true;
      };
    }

    const scopedQuery = query(
      collection(db, 'timeLogs'),
      where('organizationId', '==', activeOrgId),
      where('projectId', '==', projectId),
      where('issueId', '==', issueId),
    );
    const unsubscribe = onSnapshot(scopedQuery, snapshot => {
      if (cancelled) return;
      const nextLogs = snapshot.docs.map(liveDocumentData);
      nextLogs.sort((left, right) => (
        (right.loggedAt?.toMillis?.() ?? 0)
        - (left.loggedAt?.toMillis?.() ?? 0)
      ));
      setLogs(nextLogs);
      setTotalMinutes(nextLogs.reduce(
        (total, log) => total + (Number(log.spentMinutes) || 0),
        0,
      ));
      setLoading(false);
    }, error => {
      if (cancelled) return;
      reportLoadError('[useTimeLogs]', error);
      setLogs([]);
      setTotalMinutes(0);
      setLoading(false);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [activeOrgId, issueId, projectId]);

  const addTimeLog = useCallback(async (
    targetIssueId,
    targetProjectId,
    userId,
    spentMinutes,
    description = '',
    options = {},
  ) => {
    if (
      !Number.isSafeInteger(spentMinutes)
      || spentMinutes <= 0
      || spentMinutes > 525_600
    ) {
      throw new Error('Вкажіть коректну кількість хвилин');
    }
    return createTaskTimeLogViaApi({
      organizationId: activeOrgId,
      projectId: targetProjectId,
      issueId: targetIssueId,
      userId,
      spentMinutes,
      description,
      timerSessionId: options.timerSessionId,
    });
  }, [activeOrgId]);

  const updateTimeLog = useCallback(async (
    logId,
    { spentMinutes, description },
  ) => {
    const current = logs.find(log => log.id === logId);
    if (current?.invoiceId || current?.billedAt) {
      throw new Error(
        'Цей запис часу вже входить у рахунок і не може бути змінений',
      );
    }
    if (
      spentMinutes !== undefined
      && (
        !Number.isSafeInteger(spentMinutes)
        || spentMinutes <= 0
        || spentMinutes > 525_600
      )
    ) {
      throw new Error('Вкажіть коректну кількість хвилин');
    }
    if (spentMinutes === undefined && description === undefined) return undefined;
    return updateTaskTimeLogViaApi({
      organizationId: activeOrgId,
      projectId,
      issueId: current?.issueId || issueId,
      logId,
      ...(spentMinutes !== undefined ? { spentMinutes } : {}),
      ...(description !== undefined ? { description } : {}),
    });
  }, [activeOrgId, issueId, logs, projectId]);

  const deleteTimeLog = useCallback(async logId => {
    const current = logs.find(log => log.id === logId);
    if (current?.invoiceId || current?.billedAt) {
      throw new Error(
        'Цей запис часу вже входить у рахунок і не може бути видалений',
      );
    }
    return deleteTaskTimeLogViaApi({
      organizationId: activeOrgId,
      projectId,
      issueId: current?.issueId || issueId,
      logId,
    });
  }, [activeOrgId, issueId, logs, projectId]);

  return {
    logs,
    totalMinutes,
    loading,
    addTimeLog,
    updateTimeLog,
    deleteTimeLog,
  };
}
