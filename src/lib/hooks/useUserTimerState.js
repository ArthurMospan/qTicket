'use client';

import { useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { readServerTimerClock } from '@/lib/services/userTimer';
import useWorkspaceStore from '@/store/useWorkspaceStore';

export function useUserTimerState(userId) {
  const applyUserTimerState = useWorkspaceStore(state => state.applyUserTimerState);
  const calibrateTimerClock = useWorkspaceStore(state => state.calibrateTimerClock);
  const clearUserTimerState = useWorkspaceStore(state => state.clearUserTimerState);
  const flushQueuedTimerStop = useWorkspaceStore(state => state.flushQueuedTimerStop);

  useEffect(() => {
    if (!userId) {
      clearUserTimerState();
      return undefined;
    }
    let cancelled = false;
    let unsubscribe = () => {};
    const connect = async () => {
      try {
        const sample = await readServerTimerClock();
        if (!cancelled) calibrateTimerClock(sample);
      } catch { /* offline startup still gets the cached authoritative state */ }
      if (cancelled) return;
      unsubscribe = onSnapshot(doc(db, 'timerStates', userId), snapshot => {
        if (cancelled) return;
        applyUserTimerState(snapshot.exists() ? snapshot.data() : null, userId);
        flushQueuedTimerStop(userId);
      }, () => {
        // Keep the last server-confirmed timer visible during a transient loss of
        // connectivity. The listener will reconcile it on reconnect.
      });
    };
    connect();
    const flushOnline = () => {
      if (cancelled) return;
      readServerTimerClock().then(sample => {
        if (!cancelled) calibrateTimerClock(sample);
      }).catch(() => {});
      flushQueuedTimerStop(userId);
    };
    window.addEventListener('online', flushOnline);
    return () => {
      cancelled = true;
      unsubscribe();
      window.removeEventListener('online', flushOnline);
      clearUserTimerState();
    };
  }, [applyUserTimerState, calibrateTimerClock, clearUserTimerState, flushQueuedTimerStop, userId]);
}
