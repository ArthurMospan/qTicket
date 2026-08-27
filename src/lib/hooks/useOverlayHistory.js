'use client';

import { useCallback, useEffect, useId, useRef } from 'react';

const OVERLAY_STATE_KEY = 'qtOverlay';

// ── Closing a window and going somewhere are two navigations ────────────────
//
// An open overlay owns a history entry, and closing gives it back with
// `history.back()` — which the browser performs asynchronously. An action that
// closes the window and then routes somewhere therefore fires two navigations
// into the same tick, and one of them is lost: that is why the notification
// centre's «Налаштування сповіщень» did nothing on a phone. It is not that
// button's bug, it is the shape of the pair, so the rule lives here rather than
// in each call site — hand the entry back first, and go only once it is back.
//
// Use it for exactly that pair. A navigation queued while an overlay holds an
// entry runs when the entry is returned; one queued when no overlay holds an
// entry runs at once.
let overlaysHoldingHistory = 0;
const pendingNavigations = [];
// A queued navigation that is somehow never released still has to happen. Late
// is recoverable; never is what this whole file is about.
const NAVIGATION_FALLBACK_MS = 600;

function runPending(entry) {
  if (entry.done) return;
  entry.done = true;
  const index = pendingNavigations.indexOf(entry);
  if (index !== -1) pendingNavigations.splice(index, 1);
  entry.navigate();
}

function drainPendingNavigations() {
  if (overlaysHoldingHistory > 0) return;
  for (const entry of [...pendingNavigations]) runPending(entry);
}

export function navigateAfterOverlayClose(navigate) {
  if (typeof navigate !== 'function') return;
  if (typeof window === 'undefined' || overlaysHoldingHistory === 0) {
    navigate();
    return;
  }
  const entry = { navigate, done: false };
  pendingNavigations.push(entry);
  window.setTimeout(() => runPending(entry), NAVIGATION_FALLBACK_MS);
}

export function useOverlayHistory({
  isOpen,
  onClose,
  isDirty = false,
  closeConfirmation = 'Закрити вікно й залишити незбережені зміни?',
}) {
  const overlayId = useId();
  const tokenRef = useRef(`overlay-${overlayId}`);
  const activeRef = useRef(false);
  const confirmedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const dirtyRef = useRef(isDirty);
  const confirmationRef = useRef(closeConfirmation);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { dirtyRef.current = isDirty; }, [isDirty]);
  useEffect(() => { confirmationRef.current = closeConfirmation; }, [closeConfirmation]);

  const confirmClose = useCallback(() => {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return true;
    }
    return !dirtyRef.current || window.confirm(confirmationRef.current);
  }, []);

  const requestClose = useCallback(() => {
    if (!isOpen || !confirmClose()) return;
    const token = tokenRef.current;
    if (activeRef.current && window.history.state?.[OVERLAY_STATE_KEY] === token) {
      confirmedRef.current = true;
      window.history.back();
      return;
    }
    onCloseRef.current?.();
  }, [confirmClose, isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return undefined;

    const token = tokenRef.current;
    window.history.pushState({
      ...window.history.state,
      [OVERLAY_STATE_KEY]: token,
    }, '', window.location.href);
    activeRef.current = true;
    overlaysHoldingHistory += 1;

    // Idempotent: the entry is given back exactly once, whichever way this
    // overlay ends up closing.
    const releaseHold = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      overlaysHoldingHistory = Math.max(0, overlaysHoldingHistory - 1);
    };

    const handlePopState = event => {
      if (!activeRef.current || event.state?.[OVERLAY_STATE_KEY] === token) return;
      if (!confirmClose()) {
        window.history.pushState({
          ...event.state,
          [OVERLAY_STATE_KEY]: token,
        }, '', window.location.href);
        return;
      }
      releaseHold();
      onCloseRef.current?.();
      // The entry is genuinely back by the time a popstate is being handled, so
      // anything waiting on it may go now.
      drainPendingNavigations();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      const holdsEntry = activeRef.current
        && window.history.state?.[OVERLAY_STATE_KEY] === token;
      releaseHold();
      if (!holdsEntry) {
        drainPendingNavigations();
        return;
      }
      // `history.back()` returns immediately and pops later. Waiting for the
      // popstate is the whole point: a router push issued now would be the
      // second of two navigations in flight.
      const finish = () => {
        window.removeEventListener('popstate', finish);
        window.clearTimeout(timer);
        drainPendingNavigations();
      };
      const timer = window.setTimeout(finish, 300);
      window.addEventListener('popstate', finish);
      window.history.back();
    };
  }, [confirmClose, isOpen]);

  return requestClose;
}
