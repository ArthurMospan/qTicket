'use client';
import { useEffect, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { getPortalAuth } from '@/lib/portal/firebase';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';

/**
 * Signs into the QuickTeam+ (portal) Firebase project as the connected user,
 * using a short-lived custom token fetched from our own session route. Touches
 * only the portal auth instance — never the primary workspace auth.
 */
export function usePortalSession() {
  const [portalUser, setPortalUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const portalAuth = getPortalAuth();
      if (!portalAuth) { if (!cancelled) setLoading(false); return; } // integration not configured

      try {
        const { customToken } = await authenticatedRequest(
          '/api/integrations/qtplus/session',
          {},
          'Не вдалося відкрити сесію QuickTeam+',
        );
        const cred = await signInWithCustomToken(portalAuth, customToken);
        if (!cancelled) { setPortalUser(cred.user); setLoading(false); }
      } catch (err) {
        const portalError = err?.status === 404
          ? 'not_connected'
          : err?.status === 409
            ? 'grant_invalid'
            : 'upstream';
        if (!cancelled) { setError(portalError); setLoading(false); }
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { portalUser, loading, error };
}
