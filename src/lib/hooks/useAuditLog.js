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
 * One of an issue's two history feeds, newest first.
 *
 * There are two because the two sides of the desk are entitled to different
 * things. `audit` is the whole support-side work record and `firestore.rules`
 * refuses it to a client role; `statusHistory` is the part of it the customer
 * who filed the request may read, written server-side into a collection of its
 * own because rules cannot require a `where` clause, so «the audit, but only
 * the rows they may see» is not a condition that can be written.
 *
 * Which rows those are is `isCustomerVisibleAuditEntry`, and it is nearly all
 * of them: what stays behind is the desk's own machinery — where the supplier
 * tracks the work, who was added to a roster, a card reordered inside its own
 * column.
 *
 * Same query, same shape, same reader: the entries are written in the audit's
 * own shape so `describeAuditEvent` reads both out in the same words.
 *
 * @param {string} issueId The task.
 * @param {'audit'|'statusHistory'} feed Which of the two to subscribe to.
 * @param {number} windowSize How many entries to subscribe to.
 */
function useIssueHistoryFeed(issueId, feed, windowSize) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (!issueId) {
      queueMicrotask(() => setLoading(false));
      return undefined;
    }
    const historyQuery = query(
      collection(db, 'issues', issueId, feed),
      orderBy('createdAt', 'desc'),
      limit(windowSize),
    );
    const unsub = onSnapshot(historyQuery, snap => {
      setEntries(snap.docs.map(liveDocumentData));
      setHasMore(snap.size >= windowSize);
      setLoading(false);
    }, err => {
      reportLoadError(`[useIssueHistoryFeed:${feed}]`, err);
      setLoading(false);
    });
    return () => unsub();
  }, [issueId, feed, windowSize]);
  return {
    entries,
    loading,
    hasMore,
  };
}

/** The support-side work record. Refused to client roles by `firestore.rules`. */
export function useAuditLog(issueId, windowSize = AUDIT_WINDOW) {
  return useIssueHistoryFeed(issueId, 'audit', windowSize);
}

/** What happened to the request, for the person who filed it — actor included. */
export function useStatusHistory(issueId, windowSize = AUDIT_WINDOW) {
  return useIssueHistoryFeed(issueId, 'statusHistory', windowSize);
}
