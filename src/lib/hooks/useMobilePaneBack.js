'use client';

// src/lib/hooks/useMobilePaneBack.js — sync a mobile master-detail pane with
// browser history. Opening the detail pane (on <md viewports only) pushes one
// history entry, so the phone's system back gesture/button closes the pane
// instead of leaving the page.
//
// Returns requestClose() for the UI back button: it goes through
// history.back() when an entry was pushed (popstate then closes the pane), so
// the history stack never accumulates stale entries. On desktop it just calls
// onClose directly.
//
//   const requestClose = useMobilePaneBack(mobilePane === 'detail', () => setMobilePane('list'));
//   <button onClick={requestClose}>Назад</button>
import { useEffect, useRef, useCallback } from 'react';

export function useMobilePaneBack(isOpen, onClose) {
  const pushedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // System back: consume our entry and close the pane
  useEffect(() => {
    const onPop = () => {
      if (!pushedRef.current) return;
      pushedRef.current = false;
      onCloseRef.current?.();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Pane opened on mobile → push exactly one entry
  useEffect(() => {
    if (isOpen && !pushedRef.current && window.matchMedia('(max-width: 767px)').matches) {
      window.history.pushState({ qtMobilePane: true }, '');
      pushedRef.current = true;
    }
  }, [isOpen]);

  return useCallback(() => {
    if (pushedRef.current) window.history.back();
    else onCloseRef.current?.();
  }, []);
}
