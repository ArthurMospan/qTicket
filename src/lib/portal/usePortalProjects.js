'use client';
import { useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { getPortalDb } from '@/lib/portal/firebase';

/**
 * The connected user's QuickTeam+ projects. QT+ rules authorize the read by team
 * membership. Returns the raw list [{ id, name }] (for the project-link picker)
 * and its count (used by the settings-card probe). `projects` is null until the
 * first successful read.
 */
export function usePortalProjects(portalUser) {
  const [projects, setProjects] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!portalUser) return;
    const db = getPortalDb();
    if (!db) return;

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const snap = await getDocs(
          query(collection(db, 'projects'), where('team', 'array-contains', portalUser.uid)),
        );
        if (!cancelled) {
          setProjects(snap.docs.map((d) => ({ id: d.id, name: d.data().name })));
          setLoading(false);
        }
      } catch (err) {
        console.error('[qtplus] portal projects read failed:', err);
        if (!cancelled) { setError('read_failed'); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, [portalUser]);

  return { projects, count: projects?.length ?? null, loading, error };
}
