// src/lib/utils/telegramMessage.mjs
// How a QuickTeam notification reads inside Telegram.
//
// Pure and dependency-free so the formatting can be asserted without a bot
// token. Before this module every channel sent the same three lines —
// `title\n\nbody\n\nhttps://…` in plain text, one message per notification —
// which is why a sweep that had six reminders queued arrived as six identical
// looking grey blocks with no way to tell a meeting from an overdue task, and
// why nobody believed they were real. A message now says what kind of event it
// is, and a sweep that produces several for one person sends one digest.

import { safeExternalUrl } from './externalUrls.mjs';
import { plural } from './plural.mjs';

const MAX_MESSAGE_LENGTH = 4096;

// Telegram's HTML parse mode only needs these three escaped, and escaping more
// (quotes, slashes) makes ordinary Ukrainian text look like source code.
export function escapeTelegramHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// One glyph per event type. The point is pre-attentive: you should know whether
// a message needs you *now* from the notification shade, without reading it.
const TYPE_ICONS = {
  assigned: '🎯',
  commented: '💬',
  mentioned: '📣',
  status_changed: '🔄',
  deadline: '⏰',
  chat_message: '✉️',
  calendar_reminder: '📅',
  calendar_invite: '📩',
  calendar_changed: '🗓',
  birthday: '🎂',
  alert: '⚠️',
  emergency: '🚨',
  test: '🧪',
};

export function telegramTypeIcon(type) {
  return TYPE_ICONS[type] || '🔔';
}

function truncate(value, limit) {
  const text = String(value ?? '').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function renderItem(item, { linkTitle }) {
  const icon = telegramTypeIcon(item.type);
  const title = escapeTelegramHtml(truncate(item.title, 200));
  const url = safeExternalUrl(item.url);
  const head = linkTitle && url
    ? `${icon} <a href="${escapeTelegramHtml(url)}"><b>${title}</b></a>`
    : `${icon} <b>${title}</b>`;
  const body = truncate(item.body, 500);
  return body ? `${head}\n${escapeTelegramHtml(body)}` : head;
}

// A digest, unlike a stack of separate messages, can be read at a glance and
// only pings the phone once.
export function formatTelegramNotification(items) {
  const list = (items || []).filter(item => item && item.title);
  if (!list.length) return null;

  if (list.length === 1) {
    const [item] = list;
    const url = safeExternalUrl(item.url);
    return {
      text: truncate(renderItem(item, { linkTitle: false }), MAX_MESSAGE_LENGTH),
      parseMode: 'HTML',
      // A single notification gets a real button rather than a bare URL: the
      // link used to sit in the message body, where Telegram renders it as a
      // wall of percent-encoded path.
      button: url ? { text: 'Відкрити в QuickTeam', url } : null,
      // The plain-text form is what gets sent if Telegram rejects the markup,
      // so a formatting mistake degrades instead of dropping the notification.
      fallbackText: [item.title, item.body, url].filter(Boolean).join('\n\n'),
    };
  }

  const heading = `🔔 <b>QuickTeam · ${list.length} ${plural(list.length, ['сповіщення', 'сповіщення', 'сповіщень'])}</b>`;
  const text = [heading, ...list.map(item => renderItem(item, { linkTitle: true }))].join('\n\n');
  return {
    text: truncate(text, MAX_MESSAGE_LENGTH),
    parseMode: 'HTML',
    button: null,
    fallbackText: list
      .map(item => [item.title, item.body, safeExternalUrl(item.url)].filter(Boolean).join('\n'))
      .join('\n\n'),
  };
}
