'use client';

// src/lib/hooks/useAuditLog.js — Audit history for an issue (subcollection)
//
// This used to read the subcollection *whole*, sort it in the browser, and then
// keep the newest fifty. A task with four hundred recorded changes therefore
// cost four hundred document reads to draw fifty rows, and the cost grew every
// time anybody touched the task — the one collection in the product guaranteed
// to grow forever.
//
// Ordering and limiting are what a database is for. Fifty rows now cost fifty
// reads, whatever the task's history looks like.
import { useState, useEffect } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { reportLoadError } from '@/lib/utils/errors';
import { liveDocumentData } from '@/lib/utils/firestoreDocument.mjs';

export const AUDIT_WINDOW = 50;

/**
 * The task's recorded changes, newest first.
 *
 * @param {string} issueId The task.
 * @param {number} windowSize How many entries to subscribe to.
 */
export function useAuditLog(issueId, windowSize = AUDIT_WINDOW) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (!issueId) {
      queueMicrotask(() => setLoading(false));
      return undefined;
    }
    const historyQuery = query(
      collection(db, 'issues', issueId, 'audit'),
      orderBy('createdAt', 'desc'),
      limit(windowSize),
    );
    const unsub = onSnapshot(historyQuery, snap => {
      setEntries(snap.docs.map(liveDocumentData));
      setHasMore(snap.size >= windowSize);
      setLoading(false);
    }, err => {
      reportLoadError('[useAuditLog]', err);
      setLoading(false);
    });
    return () => unsub();
  }, [issueId, windowSize]);
  return {
    entries,
    loading,
    hasMore,
  };
}
