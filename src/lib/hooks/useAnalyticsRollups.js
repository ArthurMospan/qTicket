'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';

import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import { reportLoadError } from '@/lib/utils/errors';
import { ANALYTICS_ROLLUPS_COLLECTION } from '@/lib/utils/analyticsRollups.mjs';
import { chunkProjectIds } from '@/lib/utils/projectScopedQueries.mjs';

/**
 * A period's daily totals — one document per project per day.
 *
 * Cost is the number of days on screen, not the amount of work done in them.
 * «За 90 днів» across an active team is thousands of time logs and at most
 * ninety small documents per project; this reads the second thing.
 *
 * A single read rather than a live subscription, and deliberately so. A report
 * is a reading taken at a moment: nothing on this screen is acted on the way a
 * board card or a message is, and a figure that rewrites itself while somebody
 * is looking at it is a distraction rather than a feature. The screen says when
 * it was taken and offers to take another — see `readAt` and `refresh`.
 *
 * Pass no `dayRange` and nothing is read at all. That is how a screen whose
 * current tab is about records rather than sums — «Табель», «Рахунок» — avoids
 * paying for totals it will not draw.
 *
 * Asking a new question and asking the same one again are different events, and
 * they look different. A new period or a new project selection clears what is on
 * screen and shows a spinner, because the old figures answered something else.
 * Pressing refresh leaves them exactly where they are and reports `refreshing`,
 * because they are still the right figures until better ones arrive — and a
 * report that blanks itself for half a second every time somebody checks for
 * newer numbers teaches people not to check.
 */
export function useAnalyticsRollups(projectIds = [], { dayRange = null } = {}) {
  const { activeOrgId, authLoading, orgLoading } = useAppContext();
  const [rollups, setRollups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [readAt, setReadAt] = useState(null);
  const [error, setError] = useState(null);
  const [nonce, setNonce] = useState(0);
  const projectScope = [...new Set(projectIds.filter(Boolean))].sort().join(',');
  const startDay = dayRange?.startDay || '';
  const endDay = dayRange?.endDay || '';
  const target = `${activeOrgId || ''}/${projectScope}/${startDay}/${endDay}`;
  const targetRef = useRef('');
  const requestRef = useRef(0);

  const refresh = useCallback(() => setNonce(value => value + 1), []);

  useEffect(() => {
    if (!activeOrgId || !startDay || !endDay) {
      targetRef.current = '';
      queueMicrotask(() => {
        setRollups([]);
        setReadAt(null);
        setError(null);
        setRefreshing(false);
        // Still resolving the organization is not the same as having read it
        // and found nothing. Nothing asked for is neither: a screen that wants
        // no totals is not waiting for any.
        setLoading(Boolean(activeOrgId ? false : (authLoading || orgLoading)));
      });
      return undefined;
    }

    const askingSomethingElse = targetRef.current !== target;
    targetRef.current = target;
    const request = requestRef.current + 1;
    requestRef.current = request;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || requestRef.current !== request) return;
      if (askingSomethingElse) {
        setRollups([]);
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);
    });

    const chunks = chunkProjectIds(projectScope ? projectScope.split(',') : []);
    const bounds = [
      where('day', '>=', startDay),
      where('day', '<=', endDay),
    ];
    // Team calendar time belongs to the organization rather than to a project,
    // exactly as its raw logs do, so it is its own query — and it is read even
    // when the workspace has no projects at all.
    const queries = [
      query(
        collection(db, ANALYTICS_ROLLUPS_COLLECTION),
        where('organizationId', '==', activeOrgId),
        where('projectId', '==', ''),
        ...bounds,
      ),
      ...chunks.map(chunk => query(
        collection(db, ANALYTICS_ROLLUPS_COLLECTION),
        where('organizationId', '==', activeOrgId),
        where('projectId', 'in', chunk),
        ...bounds,
      )),
    ];

    Promise.allSettled(queries.map(sourceQuery => getDocs(sourceQuery))).then(results => {
      if (cancelled || requestRef.current !== request) return;
      const failures = results.filter(result => result.status === 'rejected');
      if (failures.length > 0) {
        failures.forEach(result => reportLoadError('[useAnalyticsRollups]', result.reason));
        setError(failures[0].reason || new Error('Не вдалося завантажити підсумки'));
        setLoading(false);
        setRefreshing(false);
        return;
      }
      const snapshots = results.map(result => result.value);
      setRollups(snapshots.flatMap(snapshot => snapshot.docs.map(document => ({
        ...document.data(),
        id: document.id,
      }))));
      setError(null);
      setReadAt(Date.now());
      setLoading(false);
      setRefreshing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [activeOrgId, authLoading, orgLoading, projectScope, startDay, endDay, target, nonce]);

  return { rollups, loading, refreshing, error, readAt, refresh };
}
