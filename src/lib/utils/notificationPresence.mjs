// src/lib/utils/notificationPresence.mjs
// Whether a notification is about the conversation already on the reader's
// screen.
//
// The live popup announces what has just arrived, and on a task page it was
// announcing messages into the very chat it then covered: you watched somebody
// type, saw their message land in the thread, and were told about it a second
// later by a card sitting on top of it. A notification whose conversation the
// reader is looking at has nothing left to tell them, so the popup stays down —
// the record in the bell is written either way, because the bell is the log.
//
// Pure: the workspace bridge decides with it, and the tests exercise it without
// a browser.

import { notificationConversationId } from './notificationNavigation.mjs';

// Two types are announced whatever is on screen. An emergency call is the one
// notification that must interrupt, and a test notification exists to be seen.
const ALWAYS_ANNOUNCED = new Set(['emergency', 'alert', 'test']);

/**
 * @param {object} notification The arriving notification record.
 * @param {{kind: 'issue'|'dm'|'channel', id: string}|null} visibleConversation What the reader currently has open, as published by the pane showing it.
 */
export function isConversationOnScreen(notification, visibleConversation) {
  if (!notification || !visibleConversation) return false;
  const { kind, id } = visibleConversation;
  if (!kind || !id) return false;
  if (ALWAYS_ANNOUNCED.has(notification.type)) return false;
  // A task's chat: every notification a task produces carries its id, so a
  // comment, a mention in one and a status change all resolve to the same task.
  if (kind === 'issue') return Boolean(notification.issueId) && notification.issueId === id;
  // A direct conversation is identified by the person on the other side of it,
  // which is exactly what `actorId` holds — and, on records written since, by
  // the conversation the record names outright.
  // `issueId` disqualifies the legacy shape: a task chat writes a
  // `chat_message` too — the record for «відповів вам у завданні» — and it
  // carries the answerer as its actor. Without this, having a direct
  // conversation with that person open would silence a record belonging to a
  // task, which is a different screen entirely.
  if (kind === 'dm') {
    return (notification.type === 'chat_message' && !notification.issueId && notification.actorId === id)
      || notificationConversationId(notification) === id;
  }
  // A channel names itself. Slack does not push about a mention in the channel
  // you are reading either: the record is written and marked read, and the card
  // that would have covered the conversation is not drawn.
  if (kind === 'channel') return notificationConversationId(notification) === id;
  return false;
}
