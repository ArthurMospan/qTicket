import { Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import 'server-only';
import {
  clampedTimerStopMillis,
  MAX_TIMER_DURATION_MS,
  timerMinutes,
} from '@/lib/utils/timerState.mjs';

export { MAX_TIMER_DURATION_MS };
const MAX_ID_LENGTH = 256;

export function cleanTimerId(value) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= MAX_ID_LENGTH
    && !value.includes('/')
    && !value.includes('\0')
    ? value.trim()
    : '';
}

export function cleanTimerSessionId(value) {
  const id = cleanTimerId(value);
  return /^[A-Za-z0-9_-]{8,128}$/.test(id) ? id : '';
}

export function timerStateRef(db, uid) {
  return db.collection('timerStates').doc(uid);
}

export function timerLogDocumentId(uid, timerSessionId) {
  const sessionId = cleanTimerSessionId(timerSessionId);
  if (!sessionId || !uid) return '';
  return `timer_${uid}_${sessionId}`;
}

export function timerStateError(code, status, message, details = {}) {
  const error = new Error(code);
  error.userTimer = { code, status, message, ...details };
  return error;
}

export function timerStateErrorResponse(error) {
  const { status, message, ...details } = error.userTimer;
  return NextResponse.json({ error: message, ...details }, { status });
}

function timestampIso(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function serializeTimer(timer) {
  if (!timer) return null;
  return {
    ...timer,
    startedAt: timestampIso(timer.startedAt),
    stoppedAt: timestampIso(timer.stoppedAt),
  };
}

export function serializeTimerState(state) {
  if (!state) return null;
  return {
    userId: state.userId || '',
    revision: Number(state.revision) || 0,
    active: serializeTimer(state.active),
    pending: serializeTimer(state.pending),
    updatedAt: timestampIso(state.updatedAt),
  };
}

export function stoppedTimer(active, requestedAt = null, now = Timestamp.now()) {
  const startedAtMs = active?.startedAt?.toMillis?.();
  if (!Number.isFinite(startedAtMs)) {
    throw timerStateError('TIMER_STATE_INVALID', 409, 'Стан таймера пошкоджено');
  }
  const nowMs = now.toMillis();
  const requestedMs = requestedAt ? new Date(requestedAt).getTime() : nowMs;
  const candidateMs = Number.isFinite(requestedMs) ? requestedMs : nowMs;
  const stoppedAtMs = clampedTimerStopMillis(startedAtMs, candidateMs, nowMs);
  return {
    ...active,
    stoppedAt: Timestamp.fromMillis(stoppedAtMs),
    minutes: timerMinutes(startedAtMs, stoppedAtMs),
  };
}

export function requireMatchingPendingTimer(state, {
  timerSessionId,
  userId,
  organizationId,
  projectId,
  issueId = '',
  eventId = '',
  occurrenceStartAt = '',
}) {
  const pending = state?.pending;
  const matches = pending
    && state.userId === userId
    && pending.id === timerSessionId
    && pending.organizationId === organizationId
    && (pending.projectId || '') === (projectId || '')
    && (eventId || (pending.issueId || '') === issueId)
    && (pending.eventId || '') === eventId
    && (pending.occurrenceStartAt || '') === occurrenceStartAt;
  if (!matches) {
    throw timerStateError(
      'TIMER_PENDING_MISMATCH',
      409,
      'Цей відстежений час уже змінено в іншій вкладці або на іншому пристрої',
    );
  }
  return pending;
}
