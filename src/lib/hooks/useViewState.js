'use client';

// src/lib/hooks/useViewState.js — a screen's filters, held in its address.
//
// The address is the single source of truth. There is no `useState` copy of a
// filter anywhere, because two sources can disagree and one of them is the one
// you send to somebody else.
//
// `localStorage` survives only as memory of the last visit, and it never
// competes with the address: a link that carries filters always wins, and a
// bare address restores the previous visit by rewriting itself, so what you
// bookmark is always what you are actually looking at.

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  parseViewState,
  restoredViewQuery,
  serializeViewState,
} from '@/lib/utils/viewState.mjs';

function readStoredQuery(storageKey) {
  if (!storageKey || typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(storageKey) || '';
  } catch {
    return '';
  }
}

function writeStoredQuery(storageKey, query) {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    if (query) window.localStorage.setItem(storageKey, query);
    else window.localStorage.removeItem(storageKey);
  } catch {
    // A browser with storage switched off still gets working filters; it just
    // does not remember them between visits.
  }
}

/**
 * @param {object} schema A view-state schema from `viewState.mjs`.
 * @param {object} [options]
 * @param {string} [options.storageKey] Where to remember the last visit. Omit to not remember.
 * @param {boolean} [options.ready] Hold the restore until the screen knows who and where it is.
 * @returns {[object, (patch: object) => void]} The state and a patch setter.
 */
export function useViewState(schema, { storageKey = '', ready = true } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const state = parseViewState(schema, searchParams);

  // Two filter changes in one breath would both serialize against the address
  // as it was before either landed, and the first would be silently dropped:
  // `useSearchParams` only catches up after the navigation commits. This mirror
  // is written eagerly when we navigate and re-synced whenever the address
  // changes by any other route — the Back button included.
  const currentQuery = searchParams.toString();
  const queryRef = useRef(currentQuery);
  useEffect(() => {
    queryRef.current = currentQuery;
  }, [currentQuery]);

  const navigate = useCallback((params) => {
    const query = params.toString();
    queryRef.current = query;
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, router]);

  const setViewState = useCallback((patch) => {
    const source = queryRef.current;
    const base = parseViewState(schema, source);
    navigate(serializeViewState(schema, { ...base, ...patch }, source));
  }, [navigate, schema]);

  // Remember the last visit, but only the keys this screen owns — `org` and the
  // composer's parameters are about a moment, not about a view.
  const ownQuery = serializeViewState(schema, state, '').toString();
  useEffect(() => {
    if (!ready) return;
    writeStoredQuery(storageKey, ownQuery);
  }, [ownQuery, ready, storageKey]);

  // Restore the previous visit once, under the rule in `restoredViewQuery`.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!ready || restoredRef.current || !storageKey) return;
    restoredRef.current = true;
    const restored = restoredViewQuery(schema, readStoredQuery(storageKey), currentQuery);
    if (restored === null) return;
    navigate(new URLSearchParams(restored));
  }, [currentQuery, navigate, ready, schema, storageKey]);

  return [state, setViewState];
}

export default useViewState;
