import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BIRTHDAY_NOTIFICATION_TYPE,
  NOTIFICATION_TYPES,
  REQUESTABLE_NOTIFICATION_TYPES,
  SYSTEM_NOTIFICATION_TYPES,
} from '../src/lib/utils/notificationChannels.mjs';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');

test('the client draws every type the product can produce', async () => {
  // Three lists used to disagree in three files, and the disagreement read as a
  // dead type: `birthday` sits in the client's table, the API rejects it, and
  // the conclusion — «nothing sends it» — was wrong. The sweep does.
  const header = await read('../src/components/WorkspaceHeader.jsx');
  const table = header.slice(header.indexOf('const TYPE_CFG = {'));
  const drawn = [...table.slice(0, table.indexOf('\n};')).matchAll(/^\s{2}([a-z_]+)\s*:/gm)]
    .map(match => match[1]);
  assert.deepEqual([...drawn].sort(), [...NOTIFICATION_TYPES].sort(),
    'A type nobody draws arrives in the bell with no icon; an icon for a type '
    + 'nothing produces is dead weight. The table and the registry must match.');
});

test('the API accepts exactly the requestable types', async () => {
  const route = await read('../src/app/api/notifications/route.js');
  assert.match(route, /new Set\(REQUESTABLE_NOTIFICATION_TYPES\)/);
  // System types are addressed to a whole organization on somebody else's
  // behalf. A browser holding a valid token must not be able to send one.
  for (const type of SYSTEM_NOTIFICATION_TYPES) {
    assert.equal(REQUESTABLE_NOTIFICATION_TYPES.includes(type), false, type);
  }
});

test('the birthday greeting is live, and is the reason the type exists', async () => {
  const jobs = await read('../src/lib/server/reminderJobs.js');
  // The sweep writes it straight through the Admin SDK, which is why it never
  // appears in the route's allow-list.
  assert.match(jobs, /type: BIRTHDAY_NOTIFICATION_TYPE,/);
  assert.match(jobs, /createBirthdayNotifications\(\{/);
  assert.equal(BIRTHDAY_NOTIFICATION_TYPE, 'birthday');
  assert.equal(NOTIFICATION_TYPES.includes(BIRTHDAY_NOTIFICATION_TYPE), true);
});
