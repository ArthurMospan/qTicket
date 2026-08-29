import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHANNEL_DEFAULTS,
  EVENT_DEFAULTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  QTICKET_NOTIFICATION_EVENT_KEYS,
  filterRecipients,
  isChannelEnabled,
  resolveNotificationMatrix,
  shouldDeliver,
} from '../src/lib/utils/notificationChannels.mjs';

test('a brand-new account keeps the defaults it had before the matrix', () => {
  const matrix = resolveNotificationMatrix({});
  for (const { key } of NOTIFICATION_EVENTS) {
    assert.equal(matrix.inapp[key], EVENT_DEFAULTS[key], `inapp/${key}`);
  }
  // Email only ever accepted assigned/mentioned/deadline.
  assert.deepEqual(matrix.email, {
    assigned: true,
    commented: false,
    mentioned: true,
    statusChanged: false,
    deadline: true,
    // Chat gained a switch; email never carried chat and still does not.
    chatMessage: false,
  });
});

test('a legacy document keeps meaning exactly what it meant', () => {
  // Pre-matrix shape: one flag per event, no `channels`.
  const legacy = {
    assigned: true,
    commented: true,
    mentioned: false,
    statusChanged: true,
    deadline: false,
    emailEnabled: true,
    // A document written while the Telegram integration existed still carries
    // this. Nothing reads it now, and it must not resurrect a column.
    telegramEnabled: true,
  };
  const matrix = resolveNotificationMatrix(legacy);

  // In-app received everything the event flags allowed. chatMessage had no flag
  // in the legacy shape and no switch anywhere, so it falls back to what the
  // channel policy was already doing: everything.
  assert.deepEqual(matrix.inapp, {
    assigned: true, commented: true, mentioned: false, statusChanged: true, deadline: false,
    chatMessage: true,
  });
  assert.equal(matrix.telegram, undefined);

  // Email intersected the flags with its hardcoded type list, which is why
  // "Зміна статусу" was on yet no status email ever arrived.
  assert.deepEqual(matrix.email, {
    assigned: true, commented: false, mentioned: false, statusChanged: false, deadline: false,
    chatMessage: false,
  });
});

test('an explicit choice wins over the legacy fallback', () => {
  const preferences = {
    statusChanged: false,
    emailEnabled: true,
    channels: { email: { statusChanged: true } },
  };
  const matrix = resolveNotificationMatrix(preferences);
  assert.equal(matrix.email.statusChanged, true);
  // Untouched cells still fall back rather than resetting to a default.
  assert.equal(matrix.inapp.statusChanged, false);
});

test('false is honoured and never mistaken for "unset"', () => {
  // `assigned` is one of the three types email always carried, so an explicit
  // false is the only thing that tells "off" apart from "never chosen".
  const matrix = resolveNotificationMatrix({
    channels: { email: { assigned: false } },
    emailEnabled: true,
  });
  assert.equal(matrix.email.assigned, false);
  assert.equal(shouldDeliver({
    channels: { email: { assigned: false } },
    emailEnabled: true,
  }, 'email', 'assigned'), false);
});

test('a channel master switch overrides every cell in its column', () => {
  const preferences = {
    emailEnabled: false,
    channels: {
      email: { assigned: true },
    },
  };
  assert.equal(shouldDeliver(preferences, 'email', 'assigned'), false);
  // In-app has no master, so its cells decide on their own.
  assert.equal(shouldDeliver(preferences, 'inapp', 'assigned'), true);
});

test('in-app is always reachable as a channel but still respects its cells', () => {
  assert.equal(isChannelEnabled({}, 'inapp'), true);
  assert.equal(shouldDeliver({ channels: { inapp: { commented: false } } }, 'inapp', 'commented'), false);
  assert.equal(shouldDeliver({ channels: { inapp: { commented: true } } }, 'inapp', 'commented'), true);
});

test('channels are independent of one another', () => {
  const preferences = {
    emailEnabled: true,
    channels: {
      inapp: { commented: false },
      email: { commented: true },
    },
  };
  // Email must still fire even though nothing lands in the bell — that
  // independence is the whole point of the matrix.
  assert.equal(shouldDeliver(preferences, 'inapp', 'commented'), false);
  assert.equal(shouldDeliver(preferences, 'email', 'commented'), true);
});

test('types with no per-event switch follow their channel policy', () => {
  // In-app has no master switch, so a switchless type is recorded in the bell
  // whatever else the document says.
  for (const type of ['alert', 'emergency', 'test']) {
    assert.equal(shouldDeliver({ emailEnabled: false }, 'inapp', type), true, `${type} in-app`);
    assert.equal(shouldDeliver({ emailEnabled: true }, 'inapp', type), true, `${type} in-app`);
  }
});

test('email stays narrow for switchless types so chat cannot flood a mailbox', () => {
  const on = { emailEnabled: true };
  assert.equal(shouldDeliver(on, 'email', 'alert'), true);
  assert.equal(shouldDeliver(on, 'email', 'emergency'), true);
  for (const type of ['chat_message', 'test']) {
    assert.equal(shouldDeliver(on, 'email', type), false, `${type} must not email`);
  }
});

test('status_changed maps to the statusChanged key, not to its own name', () => {
  const preferences = { emailEnabled: true, channels: { email: { statusChanged: true } } };
  assert.equal(shouldDeliver(preferences, 'email', 'status_changed'), true);
});

test('an unknown channel is refused rather than defaulting to send', () => {
  assert.equal(shouldDeliver({ emailEnabled: true }, 'sms', 'assigned'), false);
  assert.equal(isChannelEnabled({}, 'sms'), false);
});

test('malformed documents do not throw', () => {
  for (const preferences of [undefined, null, {}, { channels: null }, { channels: 'nope' }, { channels: { email: null } }]) {
    assert.doesNotThrow(() => resolveNotificationMatrix(preferences));
    assert.doesNotThrow(() => shouldDeliver(preferences, 'email', 'assigned'));
  }
  assert.deepEqual(Object.keys(resolveNotificationMatrix(null)), NOTIFICATION_CHANNELS);
});

test('filterRecipients splits one audience per channel', () => {
  const entries = [
    { userId: 'a', preferences: { emailEnabled: true, channels: { email: { assigned: true } } } },
    { userId: 'b', preferences: { emailEnabled: true, channels: { email: { assigned: false } } } },
    { userId: 'c', preferences: { emailEnabled: false, channels: { email: { assigned: true } } } },
  ];
  assert.deepEqual(filterRecipients(entries, 'email', 'assigned').map(item => item.userId), ['a']);
});

test('channel defaults mirror what the settings page starts from', () => {
  assert.deepEqual(CHANNEL_DEFAULTS, {
    sound: true, popup: true, emailEnabled: false,
  });
});

// The Telegram integration was deleted with the other inherited messengers, so
// the column delivered nowhere while a stored `telegramEnabled` still read back
// as a preference somebody had set. A channel that cannot carry anything is not
// a channel that happens to be switched off.
test('there is no Telegram channel, whatever a stored document says', () => {
  assert.deepEqual(NOTIFICATION_CHANNELS, ['inapp', 'email']);
  assert.equal(Object.hasOwn(CHANNEL_DEFAULTS, 'telegramEnabled'), false);

  const stored = { telegramEnabled: true, channels: { telegram: { assigned: true } } };
  assert.equal(isChannelEnabled(stored, 'telegram'), false);
  assert.equal(shouldDeliver(stored, 'telegram', 'assigned'), false);
  assert.equal(shouldDeliver(stored, 'telegram', 'alert'), false);
  assert.equal(resolveNotificationMatrix(stored).telegram, undefined);
});

// «Сповіщення» belongs to the client roles — an internal seat's preferences
// arrive from QuickTeam — so the rows are the events a client can be the
// subject of. «Терміни вирішення» is not one of them: that reminder only ever
// goes to an assignee, and a client is never an assignee.
const CLIENT_UNREACHABLE_EVENT_KEYS = ['deadline'];

test('qTicket settings offer every incident event a client can be the subject of', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/(app)/settings/page.js', import.meta.url), 'utf8');
  const rows = page.slice(page.indexOf('const eventRows = ['), page.indexOf('].filter(row =>'));
  for (const key of QTICKET_NOTIFICATION_EVENT_KEYS) {
    if (CLIENT_UNREACHABLE_EVENT_KEYS.includes(key)) {
      assert.doesNotMatch(rows, new RegExp(`key: '${key}'`), `${key} cannot reach a client`);
      continue;
    }
    assert.match(rows, new RegExp(`key: '${key}'`), `${key} has no row in Settings`);
  }
  // The reminder itself still exists and still reaches an assignee — it is only
  // the client's switch for it that does not.
  assert.ok(QTICKET_NOTIFICATION_EVENT_KEYS.includes('deadline'));
  assert.doesNotMatch(rows, /Терміни вирішення/);
  assert.doesNotMatch(rows, /key: 'chatMessage'/);
});
