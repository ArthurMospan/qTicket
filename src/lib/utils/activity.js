'use client';

// Coordinates activity heartbeats between tabs on the same origin. Every tab
// may run a timer, but only the first visible tab that claims the interval is
// allowed to write to Firestore.
function heartbeatStorageKey(key) {
  return `qt:activity-heartbeat:${key}`;
}

/**
 * Whether enough time has passed since this heartbeat last *landed*.
 *
 * Split out of `claimActivityHeartbeat` for the writes that can fail. Claiming
 * and succeeding are one act for presence — it is written every minute and a
 * lost beat costs nothing — but not for a write that happens twice a day: there
 * the claim used to be recorded before the request was even sent, so a single
 * failure bought twelve hours of silence with nothing on screen to explain it.
 */
export function activityHeartbeatDue(key, intervalMs) {
  if (typeof window === 'undefined') return false;
  try {
    const previous = Number(window.localStorage.getItem(heartbeatStorageKey(key)) || 0);
    return Date.now() - previous >= intervalMs;
  } catch {
    // If storage is unavailable, let the caller through rather than block it.
    return true;
  }
}

/** Records that this heartbeat just landed. */
export function markActivityHeartbeat(key) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(heartbeatStorageKey(key), String(Date.now()));
  } catch {
    // If storage is unavailable, keep presence functional in this tab.
  }
}

export function claimActivityHeartbeat(key, intervalMs) {
  if (typeof window === 'undefined' || document.visibilityState !== 'visible') return false;
  if (!activityHeartbeatDue(key, intervalMs)) return false;
  markActivityHeartbeat(key);
  return true;
}
