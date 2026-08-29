// The typing indicator, and nothing else.
//
// This module used to carry the workspace messenger's whole vocabulary —
// direct-room ids, channel slugs, per-room unread arithmetic. That messenger is
// gone; the one conversation qTicket has is the one inside an incident, and the
// only thing it borrowed from here is the clock the heartbeat runs on.

// A "typing" flag that is never cleared (tab crash, forced reload) would stick
// forever, so writers refresh it on this cadence and readers ignore stale ones.
// Writer and reader keep the same shape and the same clock, so they agree about
// what a live flag is.
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
