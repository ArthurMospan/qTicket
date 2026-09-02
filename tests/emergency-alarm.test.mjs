// The siren says «right now». It used to say it on every page load, for an
// unread call from three days ago.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EMERGENCY_ALARM_MEMORY,
  EMERGENCY_ALARM_STORAGE_KEY,
  EMERGENCY_ALARM_WINDOW_MS,
  emergencyRecordsToAlarm,
  readAlarmedIds,
  rememberAlarmed,
  writeAlarmedIds,
} from '../src/lib/utils/emergencyAlarm.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const NOW = 1_800_000_000_000;
const at = ms => ({ toMillis: () => ms });

test('only a fresh, unread, unsounded emergency of this organization sounds', () => {
  const records = [
    { id: 'fresh', type: 'emergency', read: false, organizationId: 'org-1', createdAt: at(NOW - 60_000) },
    { id: 'old', type: 'emergency', read: false, organizationId: 'org-1', createdAt: at(NOW - EMERGENCY_ALARM_WINDOW_MS - 1) },
    { id: 'edge', type: 'emergency', read: false, organizationId: 'org-1', createdAt: at(NOW - EMERGENCY_ALARM_WINDOW_MS) },
    { id: 'read', type: 'emergency', read: true, organizationId: 'org-1', createdAt: at(NOW) },
    { id: 'elsewhere', type: 'emergency', read: false, organizationId: 'org-2', createdAt: at(NOW) },
    { id: 'comment', type: 'commented', read: false, organizationId: 'org-1', createdAt: at(NOW) },
    { id: 'sounded', type: 'emergency', read: false, organizationId: 'org-1', createdAt: at(NOW) },
  ];
  const sounding = emergencyRecordsToAlarm(records, {
    organizationId: 'org-1',
    alarmedIds: ['sounded'],
    nowMs: NOW,
  });
  // Ten minutes is the window, inclusive; a second past it the call is history,
  // and the red record in the bell is what says so.
  assert.deepEqual(sounding.map(record => record.id), ['fresh', 'edge']);
});

test('a record whose time is unknown sounds rather than being assumed old', () => {
  // Swallowing a real emergency is the one mistake the module must not make.
  const records = [
    { id: 'no-time', type: 'emergency', read: false, organizationId: 'org-1' },
    { id: 'date', type: 'emergency', read: false, organizationId: 'org-1', createdAt: new Date(NOW - 1000) },
    { id: 'millis', type: 'emergency', read: false, organizationId: 'org-1', createdAt: NOW - 2000 },
  ];
  assert.deepEqual(
    emergencyRecordsToAlarm(records, { organizationId: 'org-1', nowMs: NOW }).map(record => record.id),
    ['no-time', 'date', 'millis'],
  );
  assert.deepEqual(emergencyRecordsToAlarm(null, { organizationId: 'org-1', nowMs: NOW }), []);
});

test('the browser remembers what sounded, newest last, and not without bound', () => {
  assert.deepEqual(rememberAlarmed(['a', 'b'], ['c']), ['a', 'b', 'c']);
  // Sounding again moves a record to the end rather than listing it twice.
  assert.deepEqual(rememberAlarmed(['a', 'b'], ['a']), ['b', 'a']);
  assert.deepEqual(rememberAlarmed(undefined, []), []);
  const many = Array.from({ length: EMERGENCY_ALARM_MEMORY + 10 }, (_, index) => `id-${index}`);
  const kept = rememberAlarmed(many, ['last']);
  assert.equal(kept.length, EMERGENCY_ALARM_MEMORY);
  assert.equal(kept[kept.length - 1], 'last');
  assert.equal(kept[0], 'id-11');
});

test('storage that is absent, blocked or full is an empty memory, not an error', () => {
  assert.deepEqual(readAlarmedIds(null), []);
  assert.deepEqual(readAlarmedIds({ getItem: () => 'not json' }), []);
  assert.deepEqual(readAlarmedIds({ getItem: () => '{"a":1}' }), []);
  assert.deepEqual(readAlarmedIds({ getItem: () => '["a", 3, "b"]' }), ['a', 'b']);
  assert.deepEqual(readAlarmedIds({ getItem: () => { throw new Error('blocked'); } }), []);

  const written = {};
  writeAlarmedIds({ setItem: (key, value) => { written[key] = value; } }, ['a']);
  assert.deepEqual(written, { [EMERGENCY_ALARM_STORAGE_KEY]: '["a"]' });
  assert.doesNotThrow(() => writeAlarmedIds({ setItem: () => { throw new Error('full'); } }, ['a']));
  assert.doesNotThrow(() => writeAlarmedIds(null, ['a']));
});

// The bridge asks the module, and no longer keeps a memory that a reload wipes.
test('the bridge sounds the siren by the module, once per browser', async () => {
  const bridge = await read('../src/components/WorkspaceNotificationBridge.jsx');
  assert.match(bridge, /emergencyRecordsToAlarm\(notificationCenter\.notifications, \{/);
  assert.match(bridge, /rememberAlarmed\(alarmedIdsRef\.current, /);
  assert.match(bridge, /writeAlarmedIds\(/);
  assert.match(bridge, /readAlarmedIds\(/);
  assert.doesNotMatch(bridge, /playedEmergencyIds/);
  // The three-part siren, and its stop on reading, are unchanged.
  assert.match(bridge, /window\.setTimeout\(playEmergencyAlarm, 3000\),\s*window\.setTimeout\(playEmergencyAlarm, 6000\),/);
  assert.match(bridge, /if \(!remainsUnread\) \{\s*timers\.forEach\(window\.clearTimeout\);/);
});
