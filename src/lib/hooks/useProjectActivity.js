'use client';

// src/lib/hooks/useProjectActivity.js
// The last few things that happened in one project.
//
// ── Why this is a hook and not a filter ──────────────────────────────────
//
// The home screen draws three activity lines on its featured project card, and
// it used to get them by subscribing to every task of every project the account
// can open and sorting the lot in memory. Three lines, seven hundred documents.
// That subscription was the widest read in the product and it was on the screen
// a sign-in lands on (docs/ARCHITECTURE.md → «Вартість читання»).
//
// Firestore can answer the question that was actually being asked: the most
// recently touched tasks of one project, ordered and limited by the database
// rather than by the browser.
//
// ── Why there are two queries and not one ────────────────────────────────
//
// `issueActivity` reads `lastActivityAt`, and falls back to `createdAt` when a
// task has none. That fallback is not a detail — measured on production,
// 326 of 720 tasks carry no activity stamp at all, because the YouTrack
// importer deliberately does not write one: `lastActivityAt` is also the unread
// cursor, and stamping it on an import would mark three hundred tasks unread
// for everybody at once.
//
// So a single `orderBy('lastActivityAt')` would silently drop nearly half the
// workspace, and two real projects here would have drawn one activity line
// where the card is built for three. Firestore cannot order by «this field, or
// that one if it is missing», so the fallback is a second query — and only when
// the first could not fill the card. It is a one-shot read rather than a
// listener: the tasks it exists to find are old imports, and old imports do not
// change. Anything created since carries a stamp and comes back in the first
// query.
//
// Cost: three documents on a normal card, six on one whose project is mostly
// imported history. Against seven hundred, per visit, per tab.
//
// ── What it deliberately does not do ─────────────────────────────────────
//
// It is not a task reader. Nothing may use this to draw a list, a count or a
// board: it returns whatever few documents the limit allows, and a screen that
// needs the tasks needs `useOrganizationIssues`.

import { useEffect, useState } from 'react';
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { reportLoadError } from '@/lib/utils/errors';
import { isArchivedIssue } from '@/lib/utils/issueArchive.mjs';
import { isCancelledIssue } from '@/lib/utils/issueCancel.mjs';
import { issueActivity } from '@/lib/utils/issueReadState.mjs';

const EMPTY = Object.freeze([]);

// How many extra documents to ask for so the filter below has something to
// drop.
//
// A cancelled task leaves the present and the past both, and an archived one
// leaves the present — neither belongs in «що відбувалось у проєкті» (AGENTS.md).
// Firestore cannot express that alongside `orderBy('lastActivityAt')` without a
// second inequality and an index per combination, and the three lines this feeds
// are not worth either. So the filter is in memory, and the query fetches a few
// more rows than the card draws.
//
// Three is the whole margin: a project's three most recent events being *all*
// cancellations is a project where the honest answer is a shorter list, and a
// card with two lines is better than one that pays for twenty documents to
// guarantee three.
const OVERSCAN = 3;

function scopedQuery(organizationId, projectId, field, count) {
  return query(
    collection(db, 'issues'),
    where('organizationId', '==', organizationId),
    where('projectId', '==', projectId),
    orderBy(field, 'desc'),
    limit(count),
  );
}

// `serverTimestamps` belongs to `data()`, not to `onSnapshot`. Passed as listen
// options it is silently ignored — the only thing `onSnapshot` accepts there is
// `includeMetadataChanges` — and a task this browser has just written comes back
// with `lastActivityAt: null` until the server confirms it, which drops it to
// its `createdAt` and out of the top of its own project's feed.
function documentsOf(snapshot) {
  return snapshot.docs.map(document => ({
    ...document.data({ serverTimestamps: 'estimate' }),
    id: document.id,
  }));
}

/** Work that is still work. See `OVERSCAN`. */
function isShowableActivity(issue) {
  return !isCancelledIssue(issue) && !isArchivedIssue(issue);
}

/** The newest by what the activity record says, however it says it. */
function newestByActivity(issues, count) {
  return [...new Map(issues.map(issue => [issue.id, issue])).values()]
    .filter(isShowableActivity)
    .map(issue => ({ issue, millis: issueActivity(issue).millis }))
    .filter(entry => entry.millis > 0)
    .sort((a, b) => b.millis - a.millis)
    .slice(0, count)
    .map(entry => entry.issue);
}

/**
 * @param {string} organizationId Active organization.
 * @param {string} projectId The one project to watch. Nothing is read without it.
 * @param {number} count How many documents to keep. Always passed to `limit()`.
 */
export function useProjectActivity(organizationId, projectId, count = 3) {
  const [issues, setIssues] = useState(EMPTY);

  useEffect(() => {
    // `queueMicrotask` rather than a bare call: setting state synchronously in
    // an effect body is a cascading render, and eslint's react-hooks rules
    // refuse it. The same shape as every other listener hook here.
    if (!organizationId || !projectId || count <= 0) {
      queueMicrotask(() => setIssues(EMPTY));
      return undefined;
    }

    let cancelled = false;
    // Read at most once per mount, and only if the stamped query came back
    // short. Held here so a later snapshot does not ask for it again.
    let fallback = null;
    let fallbackAsked = false;
    // What is read, against `count`, which is what is drawn. See `OVERSCAN`.
    const scanCount = count + OVERSCAN;

    const publish = stamped => {
      if (cancelled) return;
      setIssues(newestByActivity([...stamped, ...(fallback || [])], count));
    };

    // Built here rather than behind the helper so that the `limit(scanCount)` is
    // visible at the listener — `tests/firestore-read-cost.test.mjs` reads the
    // lines around an `onSnapshot` to decide whether it is bounded, and a
    // listener whose bound it cannot see is one it is right to refuse.
    const stampedQuery = query(
      collection(db, 'issues'),
      where('organizationId', '==', organizationId),
      where('projectId', '==', projectId),
      orderBy('lastActivityAt', 'desc'),
      limit(scanCount),
    );
    const unsubscribe = onSnapshot(
      stampedQuery,
      snapshot => {
        const stamped = documentsOf(snapshot);
        publish(stamped);
        if (stamped.length >= scanCount || fallbackAsked) return;
        fallbackAsked = true;
        getDocs(scopedQuery(organizationId, projectId, 'createdAt', scanCount))
          .then(older => {
            if (cancelled) return;
            fallback = documentsOf(older);
            publish(stamped);
          })
          .catch(error => reportLoadError('[useProjectActivity:created]', error));
      },
      error => {
        reportLoadError('[useProjectActivity]', error);
        if (!cancelled) setIssues(EMPTY);
      },
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [organizationId, projectId, count]);

  return issues;
}
