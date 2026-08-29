'use client';

import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { reportLoadError } from '@/lib/utils/errors';

/**
 * The QuickTeam task this request was transferred into, if it was.
 *
 * A read rather than a subscription: this document is written by one action on
 * this screen, and that action already reports its own answer. Nothing else
 * changes it, so a listener would spend a connection watching a document that
 * never moves.
 *
 * It lives in `issues/{id}/internal/`, which `firestore.rules` opens to
 * internal contributors only — the customer reads the incident, and where their
 * supplier tracks the work is not part of it. Pass `null` for a client viewer
 * and no read is attempted at all.
 */
export function useQuickTeamTransfer(issueId) {
  const [task, setTask] = useState(null);
  useEffect(() => {
    if (!issueId) {
      queueMicrotask(() => setTask(null));
      return undefined;
    }
    let cancelled = false;
    getDoc(doc(db, 'issues', issueId, 'internal', 'quickteam'))
      .then(snapshot => {
        if (cancelled) return;
        setTask(snapshot.exists() ? snapshot.data() : null);
      })
      .catch(error => {
        // A refusal here is a staff screen reading a staff document; it means
        // the role is not what this browser thought, and the menu simply offers
        // to create rather than to open.
        if (!cancelled) reportLoadError('[useQuickTeamTransfer]', error);
      });
    return () => { cancelled = true; };
  }, [issueId]);
  return task;
}
