// src/lib/utils/notificationPresence.mjs
// Whether a notification is about the conversation already on the reader's
// screen — and what follows from that for the record in the bell.
//
// The live popup announces what has just arrived, and on an incident page it
// was announcing messages into the very conversation it then covered: you
// watched somebody type, saw their message land in the thread, and were told
// about it a second later by a card sitting on top of it. A notification whose
// conversation the reader is looking at has nothing left to tell them, so the
// popup stays down — the record in the bell is written either way, because the
// bell is the log.
//
// The same question decides whether that record is *unread*. It is one rule,
// and it used to be two: the popup asked `isConversationOnScreen` for every
// type, the incident page marked two types read — so a status change on the
// incident you were reading was silenced and left unread at once, the counter
// rose and nothing explained why. `settleRecordsOnScreen` below is the one
// answer, and `useNotifications` is the one caller.
//
// Pure: the workspace bridge decides with it, and the tests exercise it without
// a browser.

// Two types are announced whatever is on screen. An emergency call is the one
// notification that must interrupt, and a test notification exists to be seen.
const ALWAYS_ANNOUNCED = new Set(['emergency', 'alert', 'test']);

/**
 * @param {object} notification The arriving notification record.
 * @param {{kind: 'issue', id: string}|null} visibleConversation What the reader currently has open, as published by the pane showing it.
 */
export function isConversationOnScreen(notification, visibleConversation) {
  if (!notification || !visibleConversation) return false;
  const { kind, id } = visibleConversation;
  if (!kind || !id) return false;
  if (ALWAYS_ANNOUNCED.has(notification.type)) return false;
  // The incident's conversation, which is the only conversation there is. Every
  // notification an incident produces carries its id, so a comment, a mention
  // in one and a status change all resolve to the same incident.
  if (kind === 'issue') return Boolean(notification.issueId) && notification.issueId === id;
  return false;
}

/**
 * Records that are read by being on screen.
 *
 * The server writes every record unread — it cannot see anybody's screen — so
 * the client that IS looking at the conversation stamps the record read the
 * instant it arrives, before anything draws it. The same pass answers the other
 * direction: the reader opens a conversation whose records already sit in the
 * bell, and they are read the moment the pane says it is showing them.
 *
 * Returns the same array when nothing changed, so a caller that keys work on
 * the reference does nothing when no record actually flipped.
 *
 * @param {object[]} records The bell's records.
 * @param {(record: object) => boolean} isWatching Whether the reader has this record's conversation in front of them right now.
 * @returns {{ records: object[], settledIds: string[] }} The records with the settled ones marked read, and which ones those were.
 */
export function settleRecordsOnScreen(records, isWatching) {
  if (!Array.isArray(records) || typeof isWatching !== 'function') {
    return { records, settledIds: [] };
  }
  const settledIds = [];
  let next = null;
  records.forEach((record, index) => {
    if (!record || record.read || !record.id || !isWatching(record)) return;
    if (!next) next = records.slice();
    next[index] = { ...record, read: true };
    settledIds.push(record.id);
  });
  return { records: next || records, settledIds };
}
