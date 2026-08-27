export function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function issueActivityCursor(issue) {
  return timestampMillis(issue?.lastActivityAt);
}

/**
 * What the record says last happened to a task, and when.
 *
 * `updatedAt` is deliberately not part of this chain. A task document is
 * written for reasons that are not activity on that task: a drag renumbers
 * every card in the column it lands in, a time log refreshes a mirrored total,
 * hiding a column migrates tasks out of it. Reading "the document was written"
 * as "somebody did something" is what let a task nobody had touched take the
 * top of a project's activity feed and announce, seconds ago, that it had been
 * updated.
 *
 * With nothing recorded there is still one event that certainly happened, and
 * `createdAt` is when it did. It is not the unread cursor's fallback though —
 * `issueActivityCursor` stays strictly on `lastActivityAt`, because every task
 * ever created would otherwise be unread to everyone who had not opened it.
 */
export function issueActivity(issue) {
  const recorded = timestampMillis(issue?.lastActivityAt);
  if (recorded) {
    return {
      at: issue.lastActivityAt,
      millis: recorded,
      type: issue.lastActivityType || 'updated',
    };
  }
  const created = timestampMillis(issue?.createdAt);
  return created
    ? { at: issue.createdAt, millis: created, type: 'created' }
    : { at: null, millis: 0, type: null };
}

export function isIssueUnread(issue, lastSeenAt, currentUserId) {
  const activityAt = issueActivityCursor(issue);
  if (!issue?.id || !activityAt || !currentUserId) return false;

  const actorId = issue.lastActivityActorId || issue.updatedBy || issue.createdBy;
  if (actorId && actorId === currentUserId) return false;

  return activityAt > timestampMillis(lastSeenAt);
}

const ACTIVITY_LABELS = {
  comment: 'Нове: повідомлення',
  status: 'Нове: зміна статусу',
  created: 'Нове завдання',
  restored: 'Нове: завдання відновлено',
};

/**
 * What the dot on a card or a row is about. The type is already on the document
 * that drew the card, so saying it costs no read — and «Є нове в задачі» was the
 * one thing the reader already knew from seeing the dot at all.
 */
export function unreadActivityLabel(issue) {
  const type = issue?.lastActivityType || '';
  if (ACTIVITY_LABELS[type]) return ACTIVITY_LABELS[type];
  // Bulk actions arrive as `bulk_<actionId>`; every one of them is a field of
  // the task being set from a selection, and none of them is worth its own
  // phrase on a card.
  return 'Нове: зміни в задачі';
}

/**
 * Whether one line of a task's history is new to this reader.
 *
 * The comparison is server clock against server clock: `createdAt` is written by
 * Firestore, and the cursor it is measured against was copied from the task's
 * own `lastActivityAt`. That is why the boundary in the timeline needs no second
 * cursor of its own.
 *
 * A change you made yourself is never new to you — the same rule the dot on the
 * card follows.
 */
export function isIssueChangeUnread(entry, lastSeenAt, currentUserId) {
  if (!entry || !currentUserId) return false;
  const at = timestampMillis(entry.createdAt);
  if (!at) return false;
  if (entry.userId && entry.userId === currentUserId) return false;
  return at > timestampMillis(lastSeenAt);
}

/**
 * Which of the messages a reader is consuming actually need a mark written on
 * them.
 *
 * Reading fifty messages used to cost fifty writes: every unread message got the
 * reader's id appended to its own `readBy`. Nothing needs that. Unread is
 * answered by the per-issue cursor — one document, one write, the same one the
 * dot on the card reads — and the only thing left that genuinely wants a mark on
 * the message itself is the ✓✓ receipt under the sender's own message.
 *
 * A receipt is monotonic: somebody who has read a message has read everything
 * that author sent before it. So the newest message from each other author is
 * enough to carry the whole conversation's receipts, and `receiptMarks` below
 * reads the rest back out of it. A visit costs one write per person who spoke,
 * not one per message they sent.
 */
export function receiptMarkIds(comments, readerId) {
  const newestByAuthor = new Map();
  for (const comment of comments || []) {
    const authorId = comment?.authorId;
    if (!comment?.id || !authorId || authorId === readerId) continue;
    const at = timestampMillis(comment.createdAt);
    const current = newestByAuthor.get(authorId);
    if (!current || at >= current.at) newestByAuthor.set(authorId, { id: comment.id, at });
  }
  return [...newestByAuthor.values()].map(entry => entry.id);
}

/**
 * The marks left on one author's messages, gathered per reader and oldest first.
 *
 * Each mark says «this reader was in the conversation at this hour, and had read
 * everything up to this message». Messages written before this pass carry a mark
 * of their own, so their receipts resolve exactly as they always did.
 */
export function receiptMarks(comments, authorId) {
  const byReader = new Map();
  if (!authorId) return byReader;
  for (const comment of comments || []) {
    if (!comment || comment.authorId !== authorId) continue;
    const at = timestampMillis(comment.createdAt);
    if (!at) continue;
    for (const readerId of comment.readBy || []) {
      if (!readerId || readerId === authorId) continue;
      const marks = byReader.get(readerId) || [];
      marks.push({ at, stamp: comment.readAt?.[readerId] || null });
      byReader.set(readerId, marks);
    }
  }
  for (const marks of byReader.values()) marks.sort((a, b) => a.at - b.at);
  return byReader;
}

/**
 * Who has read one message, and when.
 *
 * The hour comes from the earliest mark that covers the message rather than the
 * reader's latest one: the first visit that reached this far is when they read
 * it, and a later visit must not move the receipt of an older message forward.
 */
export function commentReaders(comment, marks) {
  const at = timestampMillis(comment?.createdAt);
  if (!at || !marks?.size) return [];
  const readers = [];
  for (const [readerId, list] of marks) {
    const covering = list.find(mark => mark.at >= at);
    if (covering) readers.push({ readerId, stamp: covering.stamp });
  }
  return readers;
}
