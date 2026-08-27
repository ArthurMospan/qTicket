'use client';

// The «Безпека» panel's data: how this account can be signed into, when it last
// was, and which devices it is signed in on.
//
// The sign-in methods and the last sign-in come from the Firebase Auth user
// already in memory — no read at all. The device list is one document, fetched
// when the panel asks for it rather than subscribed, because nothing on this
// screen changes while somebody is looking at it.

import { useCallback, useEffect, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import { activityHeartbeatDue, markActivityHeartbeat } from '@/lib/utils/activity';
import { reportLoadError } from '@/lib/utils/errors';
import { listSessions } from '@/lib/utils/accountSessions.mjs';

const SESSION_ID_KEY = 'qt:session-id';
// Half an hour, not half a day. The panel prints this stamp as «востаннє …»,
// and at twelve hours that sentence was wrong about every device somebody had
// used since breakfast — a security panel that misremembers when a browser was
// last used is worse than one that says nothing. It is still a heartbeat, not a
// tracker: one write per browser per half hour at the very most, and only when
// somebody is actually looking at the workspace.
const RECORD_INTERVAL_MS = 30 * 60 * 1000;

/** This browser's own id, minted once and kept for as long as its storage lives. */
export function deviceSessionId() {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const minted = crypto.randomUUID();
    window.localStorage.setItem(SESSION_ID_KEY, minted);
    return minted;
  } catch {
    // Private mode: the session is real, it just will not be recognised again.
    return null;
  }
}

/**
 * Records this device against the signed-in account. Mounted once, high in the
 * authenticated tree — the panel must be able to show a device without the
 * reader having to open the panel first.
 */
export function useRecordAccountSession(userId) {
  useEffect(() => {
    if (!userId) return undefined;
    const sessionId = deviceSessionId();
    if (!sessionId) return undefined;
    const key = `account-session:${userId}`;

    let cancelled = false;
    const record = () => {
      if (cancelled || !activityHeartbeatDue(key, RECORD_INTERVAL_MS)) return;
      // Deliberately not `claimActivityHeartbeat`: that one refuses a tab that
      // is not visible, and it books the interval before the request is sent.
      // Both are wrong here. A workspace restored into a background tab is
      // still a sign-in worth recording, and a failed write must not leave the
      // panel stale for the whole interval — the mark is made only once the
      // write lands, so the next attempt tries again.
      authenticatedRequest('/api/account/sessions', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      }, 'Не вдалося зберегти сеанс')
        .then(() => { if (!cancelled) markActivityHeartbeat(key); })
        .catch(() => {
          // A security panel that is one device short is worth less than a
          // workspace that refuses to open, so this stays silent.
        });
    };

    record();
    // The workspace mounts once and then stays mounted for days, so a mount is
    // not on its own a measure of when a browser was last used. Coming back to
    // the tab is: it is the moment the person is here again, and it costs a
    // write only when the interval has already run out.
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') record();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }
    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [userId]);
}

export function useAccountSessions(userId) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  // Minted once for this browser and never again; a lazy initializer keeps the
  // storage read off every render.
  const [currentSessionId] = useState(deviceSessionId);

  useEffect(() => {
    let cancelled = false;
    const publish = update => { if (!cancelled) update(); };
    if (!userId) {
      queueMicrotask(() => publish(() => { setSessions([]); setLoading(false); }));
      return () => { cancelled = true; };
    }
    queueMicrotask(() => publish(() => setLoading(true)));
    getDoc(doc(db, 'users', userId, 'settings', 'sessions'))
      .then(snapshot => publish(() => {
        setSessions(listSessions(snapshot.data(), { currentSessionId }));
        setLoading(false);
      }))
      .catch(error => {
        reportLoadError('[useAccountSessions]', error);
        publish(() => { setSessions([]); setLoading(false); });
      });
    return () => { cancelled = true; };
  }, [currentSessionId, userId]);

  // Everywhere but here. The server cuts every refresh token — Firebase has no
  // smaller unit than the account — and hands back a custom token minted for
  // this device, which is exchanged below for a session issued a moment after
  // the cut. Other browsers are left holding one from before it.
  const endOtherSessions = useCallback(async () => {
    if (!currentSessionId) throw new Error('Цей браузер не запамʼятав свій сеанс');
    setBusyId('others');
    try {
      const result = await authenticatedRequest(
        `/api/account/sessions?sessionId=${encodeURIComponent(currentSessionId)}`,
        { method: 'DELETE' },
        'Не вдалося завершити інші сеанси',
      );
      // Not optional, and not deferred: from the moment the server revoked, the
      // token in this browser is refused by our own routes. Failing here leaves
      // this device signed out too, which the confirmation says can happen.
      if (result?.customToken) await signInWithCustomToken(auth, result.customToken);
      setSessions(current => current.filter(session => session.isCurrent));
      return result;
    } finally {
      setBusyId(null);
    }
  }, [currentSessionId]);

  // `metadata.lastSignInTime` and `metadata.creationTime` are deliberately not
  // published. The panel printed them as «Останній вхід» and «Обліковий запис
  // створено», and the first of the two is not the sentence it looks like:
  // Firebase refreshes it when a *credential* is presented, so a browser that
  // has been open since yesterday reports yesterday to the person sitting in
  // it. Which devices are signed in is the question this screen answers, and
  // the rows below answer it.
  const signInUser = auth.currentUser;
  return {
    sessions,
    loading,
    busyId,
    endOtherSessions,
    currentSessionId,
    providerData: signInUser?.providerData || [],
  };
}
