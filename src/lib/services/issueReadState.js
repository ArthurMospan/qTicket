import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function markIssueSeen({ organizationId, issueId, userId, lastSeenAt }) {
  if (!organizationId || !issueId || !userId || !lastSeenAt) return;
  await setDoc(
    doc(db, 'organizations', organizationId, 'issueReadState', `${userId}_${issueId}`),
    {
      userId,
      issueId,
      lastSeenAt,
    },
    { merge: true },
  );
}

// Leaving a task is what consumes it, and "leaving" cannot be read from a single
// unmount: opening a task through a non-canonical link replaces the address a
// beat later, which remounts the detail. An unmount that is immediately followed
// by a mount of the same task is that redirect, not a reader walking away — so
// the write waits, and a re-mount cancels it.
const CONSUME_DELAY_MS = 500;
const scheduled = new Map();

export function scheduleIssueSeen({ organizationId, issueId, userId, lastSeenAt, onError }) {
  if (!organizationId || !issueId || !userId || !lastSeenAt) return;
  cancelScheduledIssueSeen(issueId);
  const timer = setTimeout(() => {
    scheduled.delete(issueId);
    markIssueSeen({ organizationId, issueId, userId, lastSeenAt }).catch(error => {
      onError?.(error);
    });
  }, CONSUME_DELAY_MS);
  scheduled.set(issueId, timer);
}

export function cancelScheduledIssueSeen(issueId) {
  const timer = scheduled.get(issueId);
  if (!timer) return;
  clearTimeout(timer);
  scheduled.delete(issueId);
}
