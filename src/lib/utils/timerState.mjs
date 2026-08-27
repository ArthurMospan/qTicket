export const MAX_TIMER_DURATION_MS = 12 * 60 * 60 * 1000;

export function timerClockOffsetMillis({ serverNow, clientReceivedAt } = {}) {
  const serverNowMs = Number(serverNow);
  const clientReceivedAtMs = Number(clientReceivedAt);
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(clientReceivedAtMs)) return null;
  return serverNowMs - clientReceivedAtMs;
}

export function timerNowMillis(localNowMs, clockOffsetMs = 0) {
  if (!Number.isFinite(localNowMs)) return null;
  return localNowMs + (Number.isFinite(clockOffsetMs) ? clockOffsetMs : 0);
}

export function timerElapsedSeconds(startedAtMs, localNowMs, clockOffsetMs = 0) {
  const nowMs = timerNowMillis(localNowMs, clockOffsetMs);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
}

// A rejected user action is not an application failure. Only transport and
// server failures should offer the error-report action in the toast.
export function timerFeedbackVariant(error) {
  const status = Number(error?.status);
  return Number.isFinite(status) && status >= 400 && status < 500 ? 'warning' : 'error';
}

export function timerStartBlock(state) {
  if (state?.pending) return 'pending';
  if (state?.active) return 'active';
  return null;
}

export function timerStopDecision(state, timerId) {
  if (!state) return 'missing';
  if (!state.active && state.pending?.id === timerId) return 'idempotent';
  if (!state.active || state.active.id !== timerId) return 'changed';
  return 'stop';
}

// A form opened from a stopped timer is only a view of the server-owned
// pending record. If another tab saves or discards that record, this local
// draft must disappear too; otherwise it can be submitted later as unrelated
// manual time and resurrect minutes the user already dealt with elsewhere.
export function timerDraftNeedsDismissal(timerSessionId, pendingTimer) {
  return Boolean(timerSessionId && pendingTimer?.id !== timerSessionId);
}

export function clampedTimerStopMillis(startedAtMs, requestedAtMs, nowMs) {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return null;
  const candidate = Number.isFinite(requestedAtMs) ? requestedAtMs : nowMs;
  return Math.min(
    nowMs,
    startedAtMs + MAX_TIMER_DURATION_MS,
    Math.max(startedAtMs, candidate),
  );
}

export function timerMinutes(startedAtMs, stoppedAtMs) {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(stoppedAtMs)) return null;
  return Math.max(1, Math.ceil((stoppedAtMs - startedAtMs) / 60_000));
}
