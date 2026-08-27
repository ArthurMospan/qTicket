'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { getPortalDb } from '@/lib/portal/firebase';

/**
 * Real-time, read-only stages of a QuickTeam+ project, read from the portal DB
 * as the connected user. QT+ rules authorize by team membership;
 * permission-denied (viewer not on the team) is a quiet, expected outcome.
 */
export function usePortalStages(qtProjectId) {
  const [stages, setStages] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!qtProjectId) return;
    const db = getPortalDb();
    if (!db) return;

    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setStages(null); setError(null); } });

    const q = query(
      collection(db, 'stages'),
      where('projectId', '==', qtProjectId),
      orderBy('order', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      if (cancelled) return;
      setStages(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      setError(null);
    }, (err) => {
      if (cancelled) return;
      if (err.code !== 'permission-denied') {
        console.error('[qtplus] portal stages read failed:', err.message);
      }
      setError(err.code === 'permission-denied' ? 'no_access' : 'read_failed');
    });

    return () => { cancelled = true; unsub(); };
  }, [qtProjectId]);

  const loading = Boolean(qtProjectId) && stages === null && error === null;
  return { stages: stages || [], loading, error };
}
