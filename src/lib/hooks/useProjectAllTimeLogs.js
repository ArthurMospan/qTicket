'use client';

// Loads task logs plus explicitly team-visible calendar logs for one project.
// Keeping these as separate Firestore queries lets security rules prove that a
// broad analytics subscription can never return a restricted calendar log.
import { useCallback, useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import { isValidRawTimeLogMinutes } from '@/lib/utils/issueAccounting.mjs';
import { reportLoadError } from '@/lib/utils/errors';
import { liveDocumentData } from '@/lib/utils/firestoreDocument.mjs';

function uniqueLogs(logs) {
  const seenIds = new Set();
  return logs.filter(log => {
    if (!log.id) return true;
    if (seenIds.has(log.id)) return false;
    seenIds.add(log.id);
    return true;
  });
}

function aggregateLogs(logs) {
  const byIssue = {};
  logs.forEach(log => {
    const { issueId, userId, spentMinutes } = log;
    if (!issueId || !isValidRawTimeLogMinutes(spentMinutes)) return;
    if (!byIssue[issueId]) {
      byIssue[issueId] = { totalMinutes: 0, byUser: {} };
    }
    byIssue[issueId].totalMinutes += spentMinutes;
    if (userId) {
      byIssue[issueId].byUser[userId] = (
        byIssue[issueId].byUser[userId] || 0
      ) + spentMinutes;
    }
  });
  return byIssue;
}

export function useProjectAllTimeLogs(projectId) {
  const { activeOrgId } = useAppContext();
  const [logs, setLogs] = useState([]);
  const [byIssue, setByIssue] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLogs([]);
      setByIssue({});
      setError(null);
      setLoading(Boolean(projectId && activeOrgId));
    });

    if (!projectId || !activeOrgId) {
      return () => {
        cancelled = true;
      };
    }

    const buckets = { task: [], calendar: [] };
    const ready = new Set();
    const publish = () => {
      if (cancelled) return;
      const merged = uniqueLogs([...buckets.task, ...buckets.calendar]);
      setLogs(merged);
      setByIssue(aggregateLogs(merged));
      if (ready.size === 2) setLoading(false);
    };
    const subscribe = (key, sourceQuery) => onSnapshot(
      sourceQuery,
      snapshot => {
        if (cancelled) return;
        buckets[key] = snapshot.docs.map(liveDocumentData);
        ready.add(key);
        publish();
      },
      error => {
        if (cancelled) return;
        reportLoadError(`[useProjectAllTimeLogs:${key}]`, error);
        setError(error);
        buckets[key] = [];
        ready.add(key);
        publish();
      },
    );

    const base = collection(db, 'timeLogs');
    const unsubs = [
      subscribe('task', query(
        base,
        where('organizationId', '==', activeOrgId),
        where('projectId', '==', projectId),
        where('issueId', '!=', ''),
      )),
      subscribe('calendar', query(
        base,
        where('organizationId', '==', activeOrgId),
        where('projectId', '==', projectId),
        where('sourceType', '==', 'calendar_event'),
        where('eventVisibility', '==', 'team'),
      )),
    ];
    return () => {
      cancelled = true;
      unsubs.forEach(unsubscribe => unsubscribe());
    };
  }, [activeOrgId, projectId, nonce]);

  return { logs, byIssue, loading, error, refresh };
}
