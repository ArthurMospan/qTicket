import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatLastSeenUk,
  isPresenceOnline,
  presenceMillis,
} from '../src/lib/utils/presence.mjs';

test('presence timestamps normalize Firestore-like values', () => {
  assert.equal(presenceMillis({ seconds: 123 }), 123_000);
  assert.equal(presenceMillis({ toMillis: () => 456 }), 456);
});

test('presence is online only inside the freshness window', () => {
  const now = Date.UTC(2026, 7, 15, 12, 0, 0);
  assert.equal(isPresenceOnline(now - 30_000, now), true);
  assert.equal(isPresenceOnline(now - 3 * 60_000, now), false);
});

test('last seen label replaces the generic offline state', () => {
  const now = Date.UTC(2026, 7, 15, 12, 0, 0);
  assert.equal(formatLastSeenUk(now - 5 * 60_000, { now }), 'Остання активність: 5 хв тому');
  assert.equal(formatLastSeenUk(now, { now, online: true }), 'В мережі');
  assert.equal(formatLastSeenUk(null, { now }), 'Активність ще не зафіксована');
});
