'use client';

import { useCallback, useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import { isValidRawTimeLogMinutes } from '@/lib/utils/issueAccounting.mjs';
import { reportLoadError } from '@/lib/utils/errors';
import { liveDocumentData } from '@/lib/utils/firestoreDocument.mjs';

export function useProjectTimeLogs(projectId) {
  const { activeOrgId } = useAppContext();
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [byUser, setByUser] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce(value => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setTotalMinutes(0);
      setByUser({});
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
      let total = 0;
      const userMap = {};
      const seenIds = new Set();
      [...buckets.task, ...buckets.calendar].forEach(log => {
        if (log.id && seenIds.has(log.id)) return;
        if (log.id) seenIds.add(log.id);
        if (!isValidRawTimeLogMinutes(log.spentMinutes)) return;
        const minutes = log.spentMinutes;
        total += minutes;
        if (log.userId) {
          userMap[log.userId] = (userMap[log.userId] || 0) + minutes;
        }
      });
      setTotalMinutes(total);
      setByUser(userMap);
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
        reportLoadError(`[useProjectTimeLogs:${key}]`, error);
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

  return { totalMinutes, byUser, loading, error, refresh };
}
