import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  clampedTimerStopMillis,
  MAX_TIMER_DURATION_MS,
  timerDraftNeedsDismissal,
  timerClockOffsetMillis,
  timerElapsedSeconds,
  timerFeedbackVariant,
  timerMinutes,
  timerStartBlock,
  timerStopDecision,
} from '../src/lib/utils/timerState.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('one server state serializes concurrent starts and preserves pending time', () => {
  assert.equal(timerStartBlock(null), null);
  assert.equal(timerStartBlock({ active: { id: 'timer-a' }, pending: null }), 'active');
  assert.equal(timerStartBlock({ active: null, pending: { id: 'timer-a' } }), 'pending');
});

test('stop is idempotent for the same timer and rejects a stale tab', () => {
  const active = { active: { id: 'timer-a' }, pending: null };
  assert.equal(timerStopDecision(active, 'timer-a'), 'stop');
  assert.equal(timerStopDecision(active, 'timer-b'), 'changed');
  assert.equal(
    timerStopDecision({ active: null, pending: { id: 'timer-a' } }, 'timer-a'),
    'idempotent',
  );
  assert.equal(timerStopDecision(null, 'timer-a'), 'missing');
});

test('the visible timer ignores a client clock that is thirteen seconds fast', () => {
  const serverStartedAt = Date.UTC(2026, 7, 25, 15, 0, 0);
  const clientReceivedAt = serverStartedAt + 13_000;
  const offset = timerClockOffsetMillis({
    serverNow: serverStartedAt,
    clientReceivedAt,
  });
  assert.equal(offset, -13_000);
  assert.equal(timerElapsedSeconds(serverStartedAt, clientReceivedAt, offset), 0);
  assert.equal(timerElapsedSeconds(serverStartedAt, clientReceivedAt + 1_000, offset), 1);
});

test('expected timer conflicts are warnings, while actual failures remain reportable', () => {
  assert.equal(timerFeedbackVariant({ status: 409 }), 'warning');
  assert.equal(timerFeedbackVariant({ status: 403 }), 'warning');
  assert.equal(timerFeedbackVariant({ status: 500 }), 'error');
  assert.equal(timerFeedbackVariant(new Error('network failed')), 'error');
});

test('a running board card shows live time as a red badge, not a blinking dot', async () => {
  const [card, sidebar] = await Promise.all([
    read('../src/components/workspace/IssueCard.jsx'),
    read('../src/components/WorkspaceSidebar.jsx'),
  ]);
  assert.match(card, /function ActiveTimerBadge\(\)/);
  assert.match(card, /<Pill\s+tone="danger"/);
  assert.match(card, /isTimerActive && <ActiveTimerBadge \/>/);
  assert.doesNotMatch(card, /bg-ink rounded-full animate-pulse ml-1/);
  assert.doesNotMatch(card, /isTimerActive \? 'ring-2 ring-ink\/20'/);
  assert.doesNotMatch(sidebar, /text-\[#3b82f6\] animate-pulse/);
  assert.match(sidebar, /<Clock size=\{14\} style=\{\{ color: 'var\(--sb-text\)' \}\} \/>/);
});

test('a timer-backed form expires with its authoritative pending session', () => {
  assert.equal(timerDraftNeedsDismissal('', null), false);
  assert.equal(timerDraftNeedsDismissal('timer-a', { id: 'timer-a' }), false);
  assert.equal(timerDraftNeedsDismissal('timer-a', { id: 'timer-b' }), true);
  assert.equal(timerDraftNeedsDismissal('timer-a', null), true);
});

test('an offline stop keeps the requested instant and caps forgotten timers', () => {
  const started = Date.UTC(2026, 7, 25, 8, 0, 0);
  const requested = started + 37 * 60_000 + 1;
  const reconnected = requested + 3 * 60 * 60_000;
  assert.equal(clampedTimerStopMillis(started, requested, reconnected), requested);
  assert.equal(timerMinutes(started, requested), 38);
  assert.equal(
    clampedTimerStopMillis(started, started + 24 * 60 * 60_000, started + 24 * 60 * 60_000),
    started + MAX_TIMER_DURATION_MS,
  );
  assert.equal(clampedTimerStopMillis(started, started - 60_000, reconnected), started);
});

test('timer APIs and log commits share the same account-owned transaction state', async () => {
  const [start, stop, clock, service, issueLog, eventLog, store, listener, rules] = await Promise.all([
    read('../src/app/api/timer/start/route.js'),
    read('../src/app/api/timer/stop/route.js'),
    read('../src/app/api/timer/clock/route.js'),
    read('../src/lib/services/userTimer.js'),
    read('../src/app/api/issues/[issueId]/time-logs/route.js'),
    read('../src/app/api/calendar/events/[eventId]/time-logs/route.js'),
    read('../src/store/useWorkspaceStore.js'),
    read('../src/lib/hooks/useUserTimerState.js'),
    read('../firestore.rules'),
  ]);
  assert.match(start, /db\.runTransaction/);
  assert.match(start, /timerStartBlock\(current\)/);
  assert.match(start, /serverNow: Date\.now\(\)/);
  assert.match(stop, /timerStopDecision\(current, timerId\)/);
  assert.match(clock, /Cache-Control': 'no-store'/);
  assert.match(service, /readServerTimerClock/);
  for (const route of [issueLog, eventLog]) {
    assert.match(route, /timerLogDocumentId/);
    assert.match(route, /requireMatchingPendingTimer/);
    assert.match(route, /pending: null/);
  }
  assert.match(store, /STOP_INTENT_PREFIX = 'qt_timer_stop_intent:'/);
  assert.match(store, /_timerAccountGeneration/);
  assert.match(store, /timerClockOffsetMs/);
  assert.match(store, /stopUserTimer\(activeTimer\.id\)/);
  assert.match(store, /navigator\.onLine === false \|\| !Number\.isFinite\(Number\(error\?\.status\)\)/);
  assert.doesNotMatch(store, /qt_active_timer|qt_pending_time_log/);
  assert.match(listener, /let cancelled = false;/);
  assert.match(listener, /if \(cancelled\) return;/);
  assert.match(rules, /match \/timerStates\/\{uid\}/);
  assert.match(rules, /allow read: if signedIn\(\) && request\.auth\.uid == uid;/);
  assert.match(rules, /allow create, update, delete: if false;/);
});

test('task and calendar drafts preserve the timer session across tab races', async () => {
  const [detail, calendar, store] = await Promise.all([
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/workspace/calendar/CalendarEventPage.jsx'),
    read('../src/store/useWorkspaceStore.js'),
  ]);
  assert.match(detail, /timerSessionId: pendingTimeLog\.id/);
  assert.match(detail, /timerSessionId: logForm\.timerSessionId/);
  assert.match(detail, /timerDraftNeedsDismissal\(timerSessionId, pendingTimeLog\)/);
  assert.match(calendar, /timerSessionId: timerSessionId \|\| undefined/);
  assert.match(calendar, /timerDraftNeedsDismissal\(timerSessionId, pendingTimeLog\)/);
  assert.match(store, /expectedTimerId && pending\.id !== expectedTimerId/);
});
