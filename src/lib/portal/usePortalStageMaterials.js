'use client';
import { useEffect, useState } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { getPortalDb } from '@/lib/portal/firebase';

/**
 * Real-time, read-only materials of one QuickTeam+ stage
 * (stages/{stageId}/materials), read from the portal DB as the connected user.
 * permission-denied is a quiet, expected outcome.
 */
export function usePortalStageMaterials(stageId) {
  const [materials, setMaterials] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!stageId) return;
    const db = getPortalDb();
    if (!db) return;

    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setMaterials(null); setError(null); } });

    const q = query(collection(db, 'stages', stageId, 'materials'), orderBy('order', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      if (cancelled) return;
      setMaterials(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      setError(null);
    }, (err) => {
      if (cancelled) return;
      if (err.code !== 'permission-denied') {
        console.error('[qtplus] portal materials read failed:', err.message);
      }
      setError(err.code === 'permission-denied' ? 'no_access' : 'read_failed');
    });

    return () => { cancelled = true; unsub(); };
  }, [stageId]);

  const loading = Boolean(stageId) && materials === null && error === null;
  return { materials: materials || [], loading, error };
}
