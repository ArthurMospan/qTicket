'use client';
// src/lib/hooks/useOptimisticPatch.js — paint a pending write before it lands.
//
// Boards render a Firestore snapshot, so a drag & drop had no effect on screen
// until the round-trip finished. @hello-pangea/dnd animates the card into the
// list as it stands when the drag ends, so the card sprang back to where it
// started and only then jumped to its new column. Overlaying the pending result
// synchronously makes the drop animation land in the right slot the first time.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyPatches, prunePatches } from '@/lib/utils/optimistic.mjs';

// An overlay that never shows up in the snapshot — offline, a rules denial we
// failed to observe — must not pin the UI to something untrue indefinitely.
//
// Each overlay is timed from when it was applied, not from the last time any
// overlay was. One timer for the whole set meant two things at once, both
// wrong: the timer restarted whenever a new card was dragged, so an overlay
// that really was stuck could survive indefinitely on a busy board; and when it
// did fire it dropped every overlay, including writes still in flight. On a
// slow connection that is a card snapping back and then jumping forward again a
// moment later, with no error anywhere — which is the kind of thing that gets
// reported as «дошка глючить» and cannot be reproduced.
const STALE_MS = 8000;

/**
 * @param {Array} items  snapshot-backed list (each entry needs an `id`)
 * @param {Function} [compare]  stable comparator; the merged list is re-sorted
 *                              with it, since an overlay can change sort keys
 * @returns {[Array, Function, Function]} [merged, applyPatch, revertPatch]
 */
export function useOptimisticPatch(items, compare) {
  const [patches, setPatches] = useState(null);
  const [syncedItems, setSyncedItems] = useState(items);
  // When each overlay was applied. A ref rather than state: it is read by the
  // expiry timer and never renders anything.
  const appliedAt = useRef(new Map());

  // Retire every overlay the snapshot has caught up with: from that point the
  // two agree, so dropping it changes nothing on screen. This runs during
  // render rather than in an effect because the merged list below has to be
  // correct on this very pass — reconciling afterwards would repaint the board
  // a second time, which is the flicker we are removing. prunePatches returns
  // the previous reference when nothing landed, so the common case re-renders
  // nothing.
  let livePatches = patches;
  if (items !== syncedItems) {
    livePatches = prunePatches(items, patches);
    setSyncedItems(items);
    if (livePatches !== patches) setPatches(livePatches);
  }

  const applyPatch = useCallback(next => {
    if (!next || Object.keys(next).length === 0) return;
    const now = Date.now();
    for (const id of Object.keys(next)) {
      // A second write to the same card extends its own deadline and nobody
      // else's — merging two overlays is still one card being written.
      appliedAt.current.set(id, now);
    }
    setPatches(prev => {
      if (!prev) return { ...next };
      const merged = { ...prev };
      // Merge per id, never replace: a swimlane drop applies the column move and
      // the assignee/epic change as two overlays on the same card, and the
      // second must not erase the first.
      for (const [id, patch] of Object.entries(next)) {
        merged[id] = merged[id] ? { ...merged[id], ...patch } : patch;
      }
      return merged;
    });
  }, []);

  const revertPatch = useCallback(ids => {
    if (!ids?.length) return;
    setPatches(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      for (const id of ids) {
        delete next[id];
        appliedAt.current.delete(id);
      }
      return Object.keys(next).length ? next : null;
    });
  }, []);

  useEffect(() => {
    if (!livePatches) return undefined;
    // The next one to expire, not all of them. Sleeping until then and dropping
    // only what is genuinely overdue means a fresh drag never resets somebody
    // else's deadline, and an expiry never takes a healthy overlay with it.
    const now = Date.now();
    const ids = Object.keys(livePatches);
    const oldest = Math.min(...ids.map(id => appliedAt.current.get(id) ?? now));
    const timer = setTimeout(() => {
      const cutoff = Date.now() - STALE_MS;
      setPatches(prev => {
        if (!prev) return prev;
        const next = {};
        for (const [id, patch] of Object.entries(prev)) {
          if ((appliedAt.current.get(id) ?? 0) > cutoff) next[id] = patch;
          else appliedAt.current.delete(id);
        }
        return Object.keys(next).length ? next : null;
      });
    }, Math.max(0, oldest + STALE_MS - now));
    return () => clearTimeout(timer);
  }, [livePatches]);

  const merged = useMemo(() => {
    const next = applyPatches(items, livePatches);
    // applyPatches only allocates when an overlay applied, so sorting in place
    // here never touches the caller's array.
    return next === items || !compare ? next : next.sort(compare);
  }, [items, livePatches, compare]);

  return [merged, applyPatch, revertPatch];
}

export default useOptimisticPatch;
