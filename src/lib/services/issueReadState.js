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

/**
 * Put a task back into the reader's inbox.
 *
 * The cursor is moved to just before the task's newest activity rather than to
 * the beginning of time: "я до цього ще повернусь" is about the change that just
 * happened, and a cursor reset to zero would announce every line of a task's
 * history as new. A cursor that already sits below that point is left alone —
 * the task is unread further back than this, and raising it would consume
 * changes the reader never saw.
 */
export async function markIssueUnread({
  organizationId,
  issueId,
  userId,
  activityMillis,
  currentSeenMillis = 0,
}) {
  if (!organizationId || !issueId || !userId || !activityMillis) return false;
  cancelScheduledIssueSeen(issueId);
  const target = activityMillis - 1;
  if (currentSeenMillis && currentSeenMillis <= target) return true;
  await markIssueSeen({
    organizationId,
    issueId,
    userId,
    lastSeenAt: new Date(target),
  });
  return true;
}
