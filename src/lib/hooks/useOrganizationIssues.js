'use client';

// src/lib/hooks/useOrganizationIssues.js
// One subscription over the tasks of every project this account can open, and
// one over their links. Every screen that needs tasks reads them from here.
//
// What this replaces, and why it is worth a module.
//
// The projects screen is the workspace's front door: it is where a sign-in
// lands, where the logo goes, where switching organization goes, and where you
// come back to between every other screen. It is also the widest read in the
// product — the per-project figures on the cards are computed from the tasks
// themselves, so drawing it means reading every task in the organization.
//
// That subscription lived inside the screen's own component, so it was torn
// down on the way out and built again on the way back, and a rebuilt listener
// is a fresh query. Ten visits to the front door was ten reads of the whole
// task set, from a project running on Firestore's free daily quota. Nothing in
// the product measured that, which is exactly how a day's allowance went
// missing without anybody being able to say to what.
//
// A listener does not have to be torn down when a screen is. This one is
// refcounted and keyed by what it reads, so a second reader shares it rather
// than opening a second copy, and leaving the screen only starts a timer:
// coming back inside GRACE_MS finds it still attached, still current, and
// costing nothing. Firestore charges for documents delivered, not for a
// listener sitting still.
//
// ── Why every task reader is here now ────────────────────────────────────
//
// Sharing one listener between visits fixed the repeated *query*. It did
// nothing about the other half of the bill, which turned out to be the larger
// one: four separate listeners were reading the same documents at the same
// time — this one for the dashboard, `useAllMyTasks` for «Мої завдання»,
// `useIssues` for the board and the task screen, `useWorkspaceAnalytics` for
// the reports. Firestore bills a delivery per listener, so one person editing
// one task in one of four open tabs paid up to sixteen reads for a single
// write, and a day's measurements put roughly thirty-four thousand of one
// evening's forty-nine thousand reads into that bucket rather than into
// queries at all.
//
// So there is one query, and the readers differ only in what they filter out of
// it in memory. Five hundred tasks is nothing for a browser and four listeners
// over them is not nothing for the quota. The screens keep their own vocabulary
// — `issues` is the working set, `allIssues` is the record, `cancelledIssues`
// is «Архів» → «Скасовані» — and that vocabulary is derived here, once, from
// the same raw documents.
//
// The grace window is generous on purpose. It is not a cache — the listener is
// live the whole time, so what it holds is never stale — it is only the answer
// to "how long is somebody likely to be away before coming back here", and for
// a workspace somebody is working in that is half an hour, not seconds.

import { useMemo, useSyncExternalStore } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { reportLoadError } from '@/lib/utils/errors';
import {
  chunkProjectIds,
  flattenDocumentBuckets,
} from '@/lib/utils/projectScopedQueries.mjs';
import { withoutArchivedIssues } from '@/lib/utils/issueArchive.mjs';
import { cancelledIssuesOf, withoutCancelledIssues } from '@/lib/utils/issueCancel.mjs';

const GRACE_MS = 30 * 60 * 1000;

const EMPTY_LIST = Object.freeze([]);
const EMPTY_SNAPSHOT = Object.freeze({ documents: EMPTY_LIST, error: null, loading: true });
const RESOLVED_EMPTY_SNAPSHOT = Object.freeze({
  documents: EMPTY_LIST,
  error: null,
  loading: false,
});
const stores = new Map();

/**
 * A refcounted live read of one collection, scoped to the projects this account
 * can already open.
 *
 * The scope is not an optimisation. Firestore applies the read rule to every
 * candidate row, so one unreachable project rejects a query over the whole
 * organization — which is why this chunks by project id rather than asking for
 * the organization in one go.
 */
function createProjectScopedStore(collectionName, organizationId, projectIds) {
  const listeners = new Set();
  let snapshot = EMPTY_SNAPSHOT;
  let unsubscribes = [];
  let stopTimer = null;

  const emit = next => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const start = () => {
    if (unsubscribes.length) return;
    const buckets = new Map();
    const delivered = new Set();
    const chunks = chunkProjectIds(projectIds);
    unsubscribes = chunks.map((chunk, chunkIndex) => onSnapshot(
      query(
        // Named rather than interpolated, so the read-cost scanner can see
        // which collections this listener is over.
        collectionName === 'issueLinks' ? collection(db, 'issueLinks') : collection(db, 'issues'),
        where('organizationId', '==', organizationId),
        where('projectId', 'in', chunk),
      ),
      { includeMetadataChanges: true },
      documentSnapshot => {
        // An empty cache is not proof that a workspace is empty. Publishing one
        // is how a deep link to a task renders «Задачу не знайдено» for a second
        // while Firestore is still reaching the server — so the first snapshot
        // of a chunk only counts once something answered it.
        if (!delivered.has(chunkIndex)
          && documentSnapshot.empty
          && documentSnapshot.metadata.fromCache) return;
        // A metadata-only event — typically the server acknowledging a write
        // this browser already applied locally — describes documents identical
        // to the ones on screen. Republishing a fresh array would re-render
        // every card for nothing, and mid drop-animation that repaint is
        // exactly the visible blink the board used to have.
        if (delivered.has(chunkIndex) && documentSnapshot.docChanges().length === 0) return;
        delivered.add(chunkIndex);
        buckets.set(chunkIndex, documentSnapshot.docs.map(document => ({
          ...document.data({ serverTimestamps: 'estimate' }),
          id: document.id,
        })));
        emit({
          documents: flattenDocumentBuckets(buckets),
          error: null,
          loading: delivered.size < chunks.length,
        });
      },
      error => {
        reportLoadError(`[useOrganization:${collectionName}]`, error);
        delivered.add(chunkIndex);
        emit({ ...snapshot, error, loading: false });
      },
    ));
  };

  const stop = () => {
    unsubscribes.forEach(unsubscribe => unsubscribe());
    unsubscribes = [];
    snapshot = EMPTY_SNAPSHOT;
  };

  const store = {
    subscribe: listener => {
      if (stopTimer) {
        window.clearTimeout(stopTimer);
        stopTimer = null;
      }
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopTimer = window.setTimeout(() => {
          stopTimer = null;
          stop();
          // Dropped rather than kept empty: the key carries the project list,
          // so a workspace that gains or loses a project would otherwise leave
          // a dead store behind for every arrangement it ever had.
          for (const [key, candidate] of stores) {
            if (candidate === store) stores.delete(key);
          }
        }, GRACE_MS);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY_SNAPSHOT,
  };

  return store;
}

const emptyStore = {
  subscribe: () => () => {},
  getSnapshot: () => RESOLVED_EMPTY_SNAPSHOT,
  getServerSnapshot: () => EMPTY_SNAPSHOT,
};

function useProjectScopedDocuments(collectionName, organizationId, projectIds) {
  // The key is the read, so two callers asking for the same thing get the same
  // listener and a caller whose scope changed gets a different one.
  const scope = useMemo(
    () => [...new Set((projectIds || []).filter(Boolean))].sort().join(','),
    [projectIds],
  );
  const store = useMemo(() => {
    if (!organizationId || !scope) return emptyStore;
    const key = `${collectionName}|${organizationId}|${scope}`;
    if (!stores.has(key)) {
      stores.set(
        key,
        createProjectScopedStore(collectionName, organizationId, scope.split(',')),
      );
    }
    return stores.get(key);
  }, [collectionName, organizationId, scope]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

/**
 * Every task of every project this account can open, in the three readings the
 * product actually uses.
 *
 * `issues` is the working set — what is being worked on now. Archived tasks are
 * not in it, so boards, counts, workload and progress do not carry work nobody
 * is doing.
 *
 * `allIssues` includes them, because a task leaving the present does not leave
 * the past: hours recorded against it are still hours somebody worked, and an
 * invoice built without them would quietly bill less than was done.
 *
 * A cancelled task is in neither. `cancelledIssues` is what «Архів» →
 * «Скасовані» lists, and `documents` is the raw set, for the one screen that
 * must open whatever a link points at whichever of the two was done to it.
 *
 * @param {string} organizationId Active organization.
 * @param {string[]} projectIds Projects this account can open.
 */
export function useOrganizationIssues(organizationId, projectIds = []) {
  const { documents, error, loading } = useProjectScopedDocuments(
    'issues',
    organizationId,
    projectIds,
  );
  const allIssues = useMemo(() => withoutCancelledIssues(documents), [documents]);
  const issues = useMemo(() => withoutArchivedIssues(allIssues), [allIssues]);
  const cancelledIssues = useMemo(() => cancelledIssuesOf(documents), [documents]);
  return { documents, issues, allIssues, cancelledIssues, error, loading };
}

/**
 * The links between those tasks, on the same shared terms.
 *
 * Links never cross projects and an organization-wide link query is rejected
 * outright, so this is chunked by the same authorized project list. Three hooks
 * used to open their own copy of it alongside their own copy of the task query;
 * both halves are shared now, for the same reason.
 *
 * @param {string} organizationId Active organization.
 * @param {string[]} projectIds Projects this account can open.
 */
export function useOrganizationIssueLinks(organizationId, projectIds = []) {
  const { documents, error, loading } = useProjectScopedDocuments(
    'issueLinks',
    organizationId,
    projectIds,
  );
  return { issueLinks: documents, error, loading };
}
