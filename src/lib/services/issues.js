'use client';

import { sendNotification } from '@/lib/hooks/useNotifications';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import { issuePath } from '@/lib/utils/issueKeys.mjs';

async function authenticatedIssueRequest(url, options, fallbackMessage) {
  return authenticatedRequest(url, options, fallbackMessage);
}

export async function createIssueViaApi({ organizationId, projectId, data }) {
  return authenticatedIssueRequest('/api/issues', {
    method: 'POST',
    body: JSON.stringify({ organizationId, projectId, data }),
  }, 'Не вдалося створити задачу');
}

// Fields whose new value changes who gets reminded, and when.
const REMINDER_FIELDS = ['dueDate', 'assigneeIds'];

/**
 * Tell the server the deadline moved, so the queued reminders move with it.
 *
 * A task's own fields are written straight from the browser, but the reminder
 * queue is not writable from a browser at all — no Firestore rule describes
 * `scheduledNotifications`, deliberately, because a row in it is an instruction
 * to notify somebody. So the composer writes the field and then asks the server
 * to recompute from what is now stored.
 *
 * Nothing is awaited and no failure is surfaced: the task change has already
 * landed, this is the notification that follows it, and the nightly sweep
 * writes whatever this missed. A toast about a reminder queue would be about
 * machinery the reader has no way to act on.
 */
export function syncIssueRemindersViaApi(issueId, changedFields) {
  if (!issueId) return;
  if (changedFields && !REMINDER_FIELDS.some(field => field in changedFields)) return;
  authenticatedIssueRequest(
    `/api/issues/${encodeURIComponent(issueId)}/reminders`,
    { method: 'POST' },
    'Не вдалося оновити нагадування',
  ).catch(() => {});
}

export async function bulkIssuesViaApi({ organizationId, issueIds, action, value }) {
  return authenticatedIssueRequest('/api/issues/bulk', {
    method: 'POST',
    body: JSON.stringify({ organizationId, issueIds, action, value }),
  }, 'Не вдалося виконати масову дію');
}

/**
 * Tell whoever was just given a task. Being assigned is the same event wherever
 * the task was created from, so both composers say it the same way — the one on
 * «Мої завдання» used to say nothing at all, and a task created there reached
 * its assignee only if they happened to look at the board.
 *
 * Best-effort: a task that exists must not appear to have failed because a
 * notification did not go out. The actor is excluded server-side too.
 */
export function notifyIssueAssigned({
  issueId,
  issueKey,
  title,
  assigneeIds = [],
  actorId,
  actorName,
  projectId,
  organizationId,
}) {
  const recipients = [...new Set(assigneeIds)].filter(uid => uid && uid !== actorId);
  if (!recipients.length || !issueId || !projectId) return Promise.resolve(null);
  return sendNotification({
    userIds: recipients,
    type: 'assigned',
    title: `${actorName || 'Колега'} призначив вам нове завдання`,
    body: title || '',
    link: issuePath({ id: issueId, issueKey }, projectId),
    issueId,
    projectId,
    organizationId,
  }).catch(() => null);
}

export async function transitionIssueStatusViaApi({
  issueId,
  status,
  order,
  orderUpdates,
}) {
  if (!issueId) throw new Error('Issue is required');
  return authenticatedIssueRequest(
    `/api/issues/${encodeURIComponent(issueId)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        ...(order !== undefined ? { order } : {}),
        ...(Array.isArray(orderUpdates) ? { orderUpdates } : {}),
      }),
    },
    'Не вдалося змінити статус задачі',
  );
}

/**
 * Puts a task in the archive, or takes it back out. Reversible and with no
 * clock on it — deletion is the other thing, and it lands in «Нещодавно
 * видалене» instead. See src/lib/utils/issueArchive.mjs.
 */
export async function setIssueArchived(issueId, archived) {
  return authenticatedRequest(
    `/api/issues/${encodeURIComponent(issueId)}/archive`,
    { method: 'PATCH', body: JSON.stringify({ archived }) },
    'Не вдалося змінити стан архіву завдання',
  );
}

/**
 * Cancels a task, or takes the cancellation back. Reversible and with no clock
 * on it, like the archive — and unlike it, a cancelled task leaves the record
 * as well as the working set. See src/lib/utils/issueCancel.mjs.
 */
export async function setIssueCancelled(issueId, cancelled) {
  return authenticatedRequest(
    `/api/issues/${encodeURIComponent(issueId)}/cancel`,
    { method: 'PATCH', body: JSON.stringify({ cancelled }) },
    'Не вдалося змінити стан скасування завдання',
  );
}

/** Deleted tasks that can still be restored (a 24-hour window). */
export async function fetchDeletedIssues(organizationId) {
  const result = await authenticatedRequest(
    `/api/issues/trash?organizationId=${encodeURIComponent(organizationId)}`,
    { cache: 'no-store' },
    'Не вдалося прочитати нещодавно видалені завдання',
  );
  return result.items || [];
}

export async function restoreDeletedIssue(issueId, organizationId) {
  return authenticatedRequest(
    `/api/issues/${encodeURIComponent(issueId)}/restore`,
    { method: 'POST', body: JSON.stringify({ organizationId }) },
    'Не вдалося відновити завдання',
  );
}
