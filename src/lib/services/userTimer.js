'use client';

import { authenticatedRequest } from '@/lib/services/authenticatedRequest';

function clockSample(result, clientReceivedAt) {
  return Number.isFinite(Number(result?.serverNow))
    ? { serverNow: Number(result.serverNow), clientReceivedAt }
    : null;
}

async function timerMutation(url, options, fallbackMessage) {
  const result = await authenticatedRequest(url, options, fallbackMessage);
  const clientReceivedAt = Date.now();
  return { ...result, clockSample: clockSample(result, clientReceivedAt) };
}

export function startUserTimer(input) {
  return timerMutation('/api/timer/start', {
    method: 'POST',
    body: JSON.stringify(input),
  }, 'Не вдалося запустити таймер');
}

export function stopUserTimer(timerId, requestedAt = null) {
  return timerMutation('/api/timer/stop', {
    method: 'POST',
    body: JSON.stringify({ timerId, ...(requestedAt ? { requestedAt } : {}) }),
  }, 'Не вдалося зупинити таймер');
}

export function discardPendingUserTimer(timerId) {
  return timerMutation('/api/timer/pending', {
    method: 'DELETE',
    body: JSON.stringify({ timerId }),
  }, 'Не вдалося відхилити відстежений час');
}

export async function readServerTimerClock() {
  const response = await fetch('/api/timer/clock', {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !Number.isFinite(Number(result?.serverNow))) {
    throw new Error('Не вдалося звірити час таймера');
  }
  return {
    serverNow: Number(result.serverNow),
    clientReceivedAt: Date.now(),
  };
}
