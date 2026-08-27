'use client';
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

/**
 * Real-time org-level QuickTeam+ integration toggle, read from
 * organizations/{orgId}/settings/integrations. Mirrors the settings page
 * (settings/page.js:799-802,1233): enabled = doc exists && qtPortalEnabled !== false.
 * Fails closed (enabled=false) while loading, without an orgId, or on a read error.
 * Only the tab's owner/admin branch consumes this; members never read this doc.
 */
export function useQtPlusEnabled(orgId) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) {
      queueMicrotask(() => { setEnabled(false); setLoading(false); });
      return;
    }
    const ref = doc(db, 'organizations', orgId, 'settings', 'integrations');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setEnabled(snap.exists() && snap.data().qtPortalEnabled !== false);
        setLoading(false);
      },
      (err) => {
        console.warn('[qtplus] org integration flag read failed:', err.message);
        setEnabled(false);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [orgId]);

  return { enabled, loading };
}
