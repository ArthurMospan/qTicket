import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHANNEL_DEFAULTS,
  EVENT_DEFAULTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  QTICKET_NOTIFICATION_EVENT_KEYS,
  REQUESTABLE_NOTIFICATION_TYPES,
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
    // A document written before the Telegram channel was deleted still carries
    // this, and now that the channel is back it means what it said again.
    telegramEnabled: true,
  };
  const matrix = resolveNotificationMatrix(legacy);

  // In-app received everything the event flags allowed.
  assert.deepEqual(matrix.inapp, {
    assigned: true, commented: true, mentioned: false, statusChanged: true, deadline: false,
  });
  // The same per-event flags, read into the Telegram column: a legacy document
  // has no per-channel matrix, so every channel falls back to the flat flags,
  // which is exactly «what this account was already asking for».
  assert.deepEqual(matrix.telegram, {
    assigned: true, commented: true, mentioned: false, statusChanged: true, deadline: false,
  });

  // Email intersected the flags with its hardcoded type list, which is why
  // "Зміна статусу" was on yet no status email ever arrived.
  assert.deepEqual(matrix.email, {
    assigned: true, commented: false, mentioned: false, statusChanged: false, deadline: false,
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
    sound: true, popup: true, emailEnabled: false, telegramEnabled: false,
  });
});

// Telegram is a channel again, and the round trip is the thing worth holding.
// It was deleted on the rule that «a ticket system has no second messenger»,
// which is true of *import* — the thing that rule was written about — and not
// of *delivery*: a desk's whole job is telling somebody that something arrived,
// and the bell only reaches an open tab. The owner asked for it back on
// 2026-08-31, and asked for QuickTeam's implementation rather than a new one.
test('Telegram is a delivery channel, and a stored preference means what it says', () => {
  assert.deepEqual(NOTIFICATION_CHANNELS, ['inapp', 'email', 'telegram']);
  assert.equal(CHANNEL_DEFAULTS.telegramEnabled, false);

  // Off until somebody links a chat: there is nothing to enable before there is
  // somewhere to send.
  assert.equal(isChannelEnabled({}, 'telegram'), false);
  assert.equal(shouldDeliver({}, 'telegram', 'assigned'), false);

  // A preference written before the channel was deleted starts meaning
  // something again, and that is the correct outcome rather than an accident:
  // it is what that person chose, and nothing rewrote it in between.
  const stored = { telegramEnabled: true, channels: { telegram: { assigned: true, commented: false } } };
  assert.equal(isChannelEnabled(stored, 'telegram'), true);
  assert.equal(shouldDeliver(stored, 'telegram', 'assigned'), true);
  assert.equal(shouldDeliver(stored, 'telegram', 'commented'), false);

  // A keyless type has no switch of its own, and Telegram takes them all —
  // `incident_created` is the event this channel is worth having for, because a
  // request filed at midnight reaches no open tab.
  assert.equal(shouldDeliver(stored, 'telegram', 'incident_created'), true);
  assert.equal(shouldDeliver(stored, 'telegram', 'alert'), true);
  // And the master switch still gates every one of them.
  assert.equal(shouldDeliver({ telegramEnabled: false }, 'telegram', 'incident_created'), false);

  assert.deepEqual(Object.keys(resolveNotificationMatrix(stored).telegram), [
    'assigned', 'commented', 'mentioned', 'statusChanged', 'deadline',
  ]);
});

test('the deleted workspace-chat event has no switch and no way to be published', () => {
  assert.ok(!REQUESTABLE_NOTIFICATION_TYPES.includes('chat_message'));
  assert.ok(!NOTIFICATION_EVENTS.some(event => event.key === 'chatMessage'));
  assert.ok(!('chatMessage' in EVENT_DEFAULTS));
  // A stored preference for it changes nothing about the events that remain.
  const stale = { channels: { inapp: { chatMessage: false } } };
  assert.equal(shouldDeliver(stale, 'inapp', 'mentioned'), true);
  assert.deepEqual(Object.keys(resolveNotificationMatrix(stale).inapp), [
    'assigned', 'commented', 'mentioned', 'statusChanged', 'deadline',
  ]);
});

// «Сповіщення» is read by both audiences now, and the row list differs by one.
// «Терміни вирішення» only ever reaches an assignee, and a client is never one
// — so the row exists, and the screen filters it out for a customer rather than
// omitting it from the product. A switch for a message that cannot arrive is a
// promise the product does not keep; a row a support agent needs is not one to
// delete because somebody else cannot use it.
const CLIENT_UNREACHABLE_EVENT_KEYS = ['deadline'];

test('qTicket settings offer every incident event, and hide from a client only what cannot reach them', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/(app)/settings/page.js', import.meta.url), 'utf8');
  const rows = page.slice(page.indexOf('const eventRows = ['), page.indexOf('].filter(row =>'));
  for (const key of QTICKET_NOTIFICATION_EVENT_KEYS) {
    assert.match(rows, new RegExp(`key: '${key}'`), `${key} has no row in Settings`);
  }
  // …and the one a client cannot be the subject of is filtered by who is
  // looking, in the same expression that filters the event list itself.
  for (const key of CLIENT_UNREACHABLE_EVENT_KEYS) {
    assert.ok(
      page.includes(`!(clientViewer && row.key === '${key}')`),
      `${key} must be hidden from a client rather than deleted`,
    );
  }
  assert.doesNotMatch(rows, /key: 'chatMessage'/);
});
