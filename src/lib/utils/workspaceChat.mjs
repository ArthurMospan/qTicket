export function directMessageRoomId(firstUserId, secondUserId) {
  const ids = [firstUserId, secondUserId].filter(value => typeof value === 'string' && value.length > 0);
  if (ids.length !== 2) return '';
  return ids.sort((a, b) => a.localeCompare(b)).join('_');
}

// A DM room id encodes both participants, so membership is derivable from the
// id alone — which is exactly what the Firestore rules check. Writers persist
// the same pair as a `participants` array so the room stays queryable.
//
// Both halves are Firebase uids (28 alphanumeric chars), so this shape matches
// DM rooms exactly and never a human channel slug, a legacy `project_*` room
// or a numeric test room. MUST stay in sync with isDirectRoom() in
// firestore.rules — a mismatch there means a query returns documents the rules
// reject, which fails the whole query rather than just hiding a row.
const DIRECT_ROOM_ID = /^[A-Za-z0-9]{20,}_[A-Za-z0-9]{20,}$/;

export function isDirectRoomId(channelId) {
  return typeof channelId === 'string' && DIRECT_ROOM_ID.test(channelId);
}

export function directRoomParticipants(channelId) {
  if (!isDirectRoomId(channelId)) return [];
  return [...new Set(channelId.split('_'))];
}

// Slug used as the channel document id. `/` is illegal in a Firestore document
// id and `_` is reserved for DM room ids (see isDirectRoomId), so both are
// folded into `-`. Returns '' when nothing usable is left, which the caller
// must treat as an invalid name rather than writing to a garbage path.
export function channelIdFromName(name) {
  if (typeof name !== 'string') return '';
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_/\\.#$[\]]+/g, '-')
    .replace(/[^a-z0-9Ѐ-ӿ-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

// A "typing" flag that is never cleared (tab crash, forced reload) would stick
// forever, so writers refresh it on this cadence and readers ignore stale ones.
// Both conversations in the product — the workspace channel and the task chat —
// keep the same shape and the same clock, so they read with the same function.
export const TYPING_TTL_MS = 8000;
export const TYPING_REFRESH_MS = 3000;

// A typing flag is only trusted for TYPING_TTL_MS after it was refreshed;
// `typingAt` is a map of uid → epoch millis written alongside `typing`.
export function activeTypingUserIds(channel, { now = Date.now(), ttlMs = TYPING_TTL_MS, exclude = '' } = {}) {
  const typing = Array.isArray(channel?.typing) ? channel.typing : [];
  const typingAt = channel?.typingAt && typeof channel.typingAt === 'object' ? channel.typingAt : {};
  return typing.filter(uid => {
    if (!uid || uid === exclude) return false;
    const at = Number(typingAt[uid] ?? 0);
    // Documents written before `typingAt` existed have no timestamp; treating
    // them as stale is the safe default — the writer refreshes within seconds.
    return at > 0 && now - at < ttlMs;
  });
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
}

export function isVisibleChatChannel(channel, userId) {
  if (!channel?.id || channel.id === 'DM' || channel.id.startsWith('project_') || /^\d+$/.test(channel.id)) return false;
  if (channel.type === 'dm' || isDirectRoomId(channel.id)) {
    return canAccessChatChannel(channel, userId);
  }
  if (!channel.name) return false;
  return canAccessChatChannel(channel, userId);
}

export function canAccessChatChannel(channel, userId) {
  if (!channel?.id || !userId) return false;
  if (channel.type === 'dm' || isDirectRoomId(channel.id)) {
    // The room id is authoritative: a forged participants field can never
    // widen access to a direct conversation.
    return directRoomParticipants(channel.id).includes(userId);
  }
  return !Array.isArray(channel.members)
    || channel.members.length === 0
    || channel.members.includes(userId);
}

export function channelUnreadCount(channel, readCursor, userId) {
  if (!channel || channel.lastMessageSenderId === userId) return 0;
  const lastMessageAt = toMillis(channel.lastMessageAt);
  const lastReadAt = toMillis(readCursor?.lastReadAt || readCursor);
  if (!lastMessageAt || lastMessageAt <= lastReadAt) return 0;

  const messageCount = Number(channel.messageCount || 0);
  const readMessageCount = Number(readCursor?.messageCount || 0);
  if (messageCount > 0) return Math.max(1, messageCount - readMessageCount);
  return 1;
}
