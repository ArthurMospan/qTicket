import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHANNEL_DEFAULTS,
  EVENT_DEFAULTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  filterRecipients,
  isChannelEnabled,
  resolveNotificationMatrix,
  shouldDeliver,
} from '../src/lib/utils/notificationChannels.mjs';

test('a brand-new account keeps the defaults it had before the matrix', () => {
  const matrix = resolveNotificationMatrix({});
  for (const { key } of NOTIFICATION_EVENTS) {
    assert.equal(matrix.inapp[key], EVENT_DEFAULTS[key], `inapp/${key}`);
    assert.equal(matrix.telegram[key], EVENT_DEFAULTS[key], `telegram/${key}`);
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
    telegramEnabled: true,
  };
  const matrix = resolveNotificationMatrix(legacy);

  // In-app and Telegram received everything the event flags allowed.
  // chatMessage had no flag in the legacy shape and no switch anywhere, so it
  // falls back to what the channel policy was already doing: everything.
  assert.deepEqual(matrix.inapp, {
    assigned: true, commented: true, mentioned: false, statusChanged: true, deadline: false,
    chatMessage: true,
  });
  assert.deepEqual(matrix.telegram, {
    assigned: true, commented: true, mentioned: false, statusChanged: true, deadline: false,
    chatMessage: true,
  });

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
  const matrix = resolveNotificationMatrix({
    channels: { telegram: { assigned: false } },
    telegramEnabled: true,
  });
  assert.equal(matrix.telegram.assigned, false);
  assert.equal(shouldDeliver({
    channels: { telegram: { assigned: false } },
    telegramEnabled: true,
  }, 'telegram', 'assigned'), false);
});

test('a channel master switch overrides every cell in its column', () => {
  const preferences = {
    emailEnabled: false,
    telegramEnabled: false,
    channels: {
      email: { assigned: true },
      telegram: { assigned: true },
    },
  };
  assert.equal(shouldDeliver(preferences, 'email', 'assigned'), false);
  assert.equal(shouldDeliver(preferences, 'telegram', 'assigned'), false);
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
    telegramEnabled: true,
    channels: {
      inapp: { commented: false },
      email: { commented: false },
      telegram: { commented: true },
    },
  };
  assert.equal(shouldDeliver(preferences, 'inapp', 'commented'), false);
  assert.equal(shouldDeliver(preferences, 'email', 'commented'), false);
  // Telegram must still fire even though nothing lands in the bell — that
  // independence is the whole point of the matrix.
  assert.equal(shouldDeliver(preferences, 'telegram', 'commented'), true);
});

test('types with no per-event switch follow their channel policy', () => {
  const off = { emailEnabled: false, telegramEnabled: false };
  const on = { emailEnabled: true, telegramEnabled: true };
  for (const type of ['alert', 'emergency', 'calendar_reminder', 'test']) {
    assert.equal(shouldDeliver(off, 'telegram', type), false, `${type} muted`);
    assert.equal(shouldDeliver(on, 'telegram', type), true, `${type} allowed`);
    assert.equal(shouldDeliver(off, 'inapp', type), true, `${type} in-app`);
  }
});

test('email stays narrow for switchless types so chat cannot flood a mailbox', () => {
  const on = { emailEnabled: true };
  assert.equal(shouldDeliver(on, 'email', 'alert'), true);
  assert.equal(shouldDeliver(on, 'email', 'emergency'), true);
  for (const type of ['chat_message', 'calendar_reminder', 'calendar_invite', 'calendar_changed', 'test']) {
    assert.equal(shouldDeliver(on, 'email', type), false, `${type} must not email`);
  }
});

test('status_changed maps to the statusChanged key, not to its own name', () => {
  const preferences = { telegramEnabled: true, channels: { telegram: { statusChanged: true } } };
  assert.equal(shouldDeliver(preferences, 'telegram', 'status_changed'), true);
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
    sound: true, popup: true, emailEnabled: false, telegramEnabled: false,
  });
});

test('chat can be silenced on Telegram without disconnecting Telegram', () => {
  // Before it had a key, chat_message fell through to the channel policy, which
  // said yes to everything: connecting Telegram meant a push per message in
  // every channel, and the only remedy was to disconnect.
  const on = { telegramEnabled: true };
  assert.equal(shouldDeliver(on, 'telegram', 'chat_message'), true, 'default is unchanged');

  const muted = { telegramEnabled: true, channels: { telegram: { chatMessage: false } } };
  assert.equal(shouldDeliver(muted, 'telegram', 'chat_message'), false);
  // And muting chat leaves the rest of the column alone.
  assert.equal(shouldDeliver(muted, 'telegram', 'mentioned'), true);
  // The bell keeps its own answer.
  assert.equal(shouldDeliver(muted, 'inapp', 'chat_message'), true);
});

test('the settings page offers a row for every event the model declares', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/(app)/settings/page.js', import.meta.url), 'utf8');
  const rows = page.slice(page.indexOf('const eventRows = ['), page.indexOf('].filter(row =>'));
  for (const { key } of NOTIFICATION_EVENTS) {
    assert.match(rows, new RegExp(`key: '${key}'`), `${key} has no row in Settings`);
  }
});
