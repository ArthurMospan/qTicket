// src/lib/utils/notificationChannels.mjs
// Which events exist, which channels can carry them, and how a stored
// preferences document answers "send this notification type to this channel?".
//
// Pure and dependency-free on purpose: the settings UI, the notifications API
// route and the Telegram sender all have to agree, and before this module they
// did not. Each channel had its own rule buried in whichever file delivered it —
// a single set of per-event switches gated the notification record, email then
// silently dropped every type outside a hardcoded list, and Telegram received
// everything that had been created with no per-event control at all. None of
// that was visible in Settings, so the page promised choices it did not make.

export const NOTIFICATION_CHANNELS = ['inapp', 'email', 'telegram'];

// Every notification type the product can produce, split by who may ask for it.
//
// `birthday` is the one type no client can send: the greeting sweep writes it
// straight through the Admin SDK, because it is addressed to everyone in an
// organization on somebody else's behalf and nobody should be able to forge
// that from a browser. It has an icon and it reaches real bells; it is absent
// from the API's allow-list on purpose, not by oversight, and the type table on
// the client has to keep covering it. `notification-types.test.mjs` holds the
// three lists together.
export const REQUESTABLE_NOTIFICATION_TYPES = [
  'assigned',
  'commented',
  'status_changed',
  'mentioned',
  'deadline',
  'chat_message',
  'alert',
  'emergency',
  'calendar_invite',
  'calendar_changed',
  'calendar_reminder',
  'test',
];

export const BIRTHDAY_NOTIFICATION_TYPE = 'birthday';

export const SYSTEM_NOTIFICATION_TYPES = [BIRTHDAY_NOTIFICATION_TYPE];

export const NOTIFICATION_TYPES = [
  ...REQUESTABLE_NOTIFICATION_TYPES,
  ...SYSTEM_NOTIFICATION_TYPES,
];

// `key` is what the preferences document stores; `type` is what senders pass.
export const NOTIFICATION_EVENTS = [
  { key: 'assigned', type: 'assigned' },
  { key: 'commented', type: 'commented' },
  { key: 'mentioned', type: 'mentioned' },
  { key: 'statusChanged', type: 'status_changed' },
  { key: 'deadline', type: 'deadline' },
  // Chat had no switch of its own, so it rode the channel policy below: turning
  // Telegram on meant a Telegram push for every message in every channel you
  // are in, and the only way to stop that was to disconnect Telegram entirely.
  { key: 'chatMessage', type: 'chat_message' },
];

const EVENT_KEY_BY_TYPE = new Map(NOTIFICATION_EVENTS.map(event => [event.type, event.key]));

// Per-event defaults for an account that has never saved anything. Single source
// of truth: the legacy fallback below reads these too.
export const EVENT_DEFAULTS = {
  assigned: true,
  commented: true,
  mentioned: true,
  // On by default now that it reaches the task's participants rather than
  // everyone on the board: if a task you opened or were given moves, that is
  // exactly the thing you wanted to know.
  statusChanged: true,
  deadline: true,
  // True, because that is exactly what an account was already getting before
  // the switch existed. Gaining a control must not change what anyone receives.
  chatMessage: true,
};

// Channel-level switches. `inapp` has none — the record in the bell *is* the
// app, and sound/popup below are how you quieten it.
export const CHANNEL_DEFAULTS = {
  sound: true,
  popup: true,
  emailEnabled: false,
  telegramEnabled: false,
};

// Types email used to accept, hardcoded in the route. Kept only to reproduce
// what an existing account was already getting; new choices are explicit.
const LEGACY_EMAIL_TYPES = new Set(['assigned', 'mentioned', 'deadline']);

function legacyEventValue(preferences, channel, key) {
  const stored = preferences[key];
  const enabled = typeof stored === 'boolean' ? stored : EVENT_DEFAULTS[key];
  if (channel !== 'email') return enabled;
  const type = NOTIFICATION_EVENTS.find(event => event.key === key)?.type;
  return enabled && LEGACY_EMAIL_TYPES.has(type);
}

// Normalises any preferences document — pre-matrix or current — into a full
// { channel: { eventKey: boolean } } map. Explicit values win; anything missing
// falls back to what that account was effectively getting before, so opening
// this page after the update never silently changes what someone receives.
export function resolveNotificationMatrix(preferences = {}) {
  const stored = preferences && typeof preferences.channels === 'object' ? preferences.channels : null;
  const matrix = {};
  for (const channel of NOTIFICATION_CHANNELS) {
    const row = {};
    for (const { key } of NOTIFICATION_EVENTS) {
      const explicit = stored?.[channel]?.[key];
      row[key] = typeof explicit === 'boolean'
        ? explicit
        : legacyEventValue(preferences || {}, channel, key);
    }
    matrix[channel] = row;
  }
  return matrix;
}

// The channel's master switch. In-app has no master: turning every event off is
// how you silence it, which cannot leave someone with an unreachable inbox.
export function isChannelEnabled(preferences = {}, channel) {
  if (channel === 'inapp') return true;
  if (channel === 'email') return preferences?.emailEnabled === true;
  if (channel === 'telegram') return preferences?.telegramEnabled === true;
  return false;
}

// Types outside NOTIFICATION_EVENTS — chat_message, alert, emergency, the
// calendar family, test — have no switch of their own in Settings, so a channel
// policy decides. In-app records them all and Telegram takes them all, which is
// what both already did. Email stays narrow on purpose: it used to run off a
// hardcoded whitelist, and opening it up would mean a mail per chat message.
const KEYLESS_TYPE_POLICY = {
  inapp: () => true,
  telegram: () => true,
  email: type => type === 'alert' || type === 'emergency',
};

export function shouldDeliver(preferences = {}, channel, type) {
  if (!NOTIFICATION_CHANNELS.includes(channel)) return false;
  if (!isChannelEnabled(preferences, channel)) return false;
  const key = EVENT_KEY_BY_TYPE.get(type);
  if (!key) return KEYLESS_TYPE_POLICY[channel](type);
  return resolveNotificationMatrix(preferences)[channel][key] === true;
}

// Recipients of one channel, for senders that fan out to many people at once.
export function filterRecipients(entries, channel, type) {
  return entries.filter(entry => shouldDeliver(entry.preferences, channel, type));
}
