import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { shouldDeliver } from '@/lib/utils/notificationChannels.mjs';
import { formatTelegramNotification } from '@/lib/utils/telegramMessage.mjs';

/**
 * Telegram as a notification channel, and only as one.
 *
 * Ported from QuickTeam, where the bot has been delivering for a year, rather
 * than written again — the linking handshake, the digest and the plain-text
 * fallback are all decisions somebody already made and already debugged.
 *
 * What did not come across is the half of that integration that creates work:
 * QuickTeam's bot takes `/task` in a group chat and files an issue. qTicket
 * refuses that, and not for want of effort — **only a client opens a request**,
 * from their own project, so a desk can always say who asked for what. A group
 * chat has no client in it, only a room, and a request filed by a room is one
 * nobody can answer. So there is no group linking, no `telegramChats`, no
 * `createIssueFromTelegram`, and the webhook understands exactly one command.
 *
 * The channel is per person and private: a connection lives at
 * `users/{uid}/private/telegram`, which `firestore.rules` refuses to every
 * browser including its owner's. A chat id is a message anybody holding it can
 * send.
 */

function config() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN?.trim() || '',
    username: process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '',
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, ''),
  };
}

/**
 * Whether this deployment can talk to Telegram at all.
 *
 * All four values or none: a bot token without a public HTTPS origin cannot
 * receive a webhook, and a webhook without a secret is an open endpoint. The
 * settings screen draws «Інтеграцію не налаштовано в цьому середовищі» from
 * this rather than offering a switch that would fail on press.
 */
export function telegramStatus() {
  const value = config();
  return {
    configured: Boolean(
      value.token
      && /^[A-Za-z0-9_]{5,}$/.test(value.username)
      && /^[A-Za-z0-9_-]{16,256}$/.test(value.webhookSecret)
      && /^https:\/\//.test(value.appUrl),
    ),
    username: value.username,
  };
}

/** A connect token is stored by hash, never in the clear — it is a bearer secret. */
export function telegramTokenId(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function validTelegramWebhookSecret(candidate) {
  const expected = config().webhookSecret;
  if (!expected || !candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function telegramRequest(method, payload) {
  const { token } = config();
  if (!token) throw new Error('Telegram bot is not configured');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(result.description || `Telegram ${method} failed`);
  }
  return result.result;
}

export async function ensureTelegramWebhook() {
  const value = config();
  if (!telegramStatus().configured) throw new Error('Telegram integration is not configured');
  return telegramRequest('setWebhook', {
    url: `${value.appUrl}/api/integrations/telegram/webhook`,
    secret_token: value.webhookSecret,
    allowed_updates: ['message'],
  });
}

export async function sendTelegramMessage(chatId, text) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text: String(text || '').slice(0, 4096),
    link_preview_options: { is_disabled: true },
  });
}

// A formatted message, with the plain-text form as the safety net. Telegram
// answers 400 for markup it cannot parse and delivers nothing, so a stray "<" in
// a request title must not be the difference between a notification and silence.
async function sendFormattedTelegramMessage(chatId, message) {
  try {
    return await telegramRequest('sendMessage', {
      chat_id: chatId,
      text: message.text,
      parse_mode: message.parseMode,
      link_preview_options: { is_disabled: true },
      ...(message.button
        ? { reply_markup: { inline_keyboard: [[message.button]] } }
        : {}),
    });
  } catch (error) {
    console.warn('[telegram] Formatted message rejected, retrying as text:', error.message);
    return sendTelegramMessage(chatId, message.fallbackText || message.text);
  }
}

export function telegramAppLink(link) {
  if (!link) return '';
  const base = config().appUrl;
  if (!base) return '';
  return `${base}${String(link).startsWith('/') ? link : `/${link}`}`;
}

/**
 * `/start qt_<token>` and nothing else.
 *
 * Kept here rather than imported: QuickTeam parses several commands because its
 * bot files tasks, and porting that parser would bring the vocabulary of a
 * feature this product does not have.
 */
export function telegramStartPayload(text) {
  const match = String(text || '').trim().match(/^\/start(?:@\S+)?(?:\s+(\S+))?$/);
  if (!match) return null;
  return match[1] || '';
}

/**
 * Send a notification, or a digest of them, to everyone who asked for it there.
 *
 * `type` is applied through `shouldDeliver`, so the per-event switches in
 * Settings decide per notification — and in the batched form per item, because
 * a digest of four events must not be all-or-nothing on the first one's type.
 *
 * Never throws: a channel that cannot deliver reports which recipients it
 * failed, and the caller decides. A notification that reaches the bell must not
 * be lost because a bot token expired.
 */
export async function deliverTelegramNotification({
  userIds,
  title,
  body,
  link = '',
  type = '',
  itemsByUserId = null,
}) {
  const status = telegramStatus();
  const recipients = [...new Set((userIds || []).filter(Boolean))];
  if (!recipients.length) {
    return { delivered: 0, attempted: 0, failedUserIds: [], errorsByUserId: {}, skippedUserIds: [] };
  }
  if (!status.configured) {
    return {
      delivered: 0,
      attempted: recipients.length,
      failedUserIds: recipients,
      errorsByUserId: Object.fromEntries(
        recipients.map(uid => [uid, 'Telegram integration is not configured']),
      ),
      skippedUserIds: [],
    };
  }

  const db = getAdminDb();
  const [preferenceSnapshots, connectionSnapshots] = await Promise.all([
    db.getAll(...recipients.map(uid => db.collection('users').doc(uid).collection('settings').doc('notifications'))),
    db.getAll(...recipients.map(uid => db.collection('users').doc(uid).collection('private').doc('telegram'))),
  ]);
  const shared = itemsByUserId
    ? null
    : formatTelegramNotification([{ type, title, body, url: telegramAppLink(link) }]);

  const skippedUserIds = [];
  const immediateFailures = new Map();
  const deliveries = recipients.flatMap((uid, index) => {
    const preferences = preferenceSnapshots[index].exists ? preferenceSnapshots[index].data() : {};
    const connection = connectionSnapshots[index].exists ? connectionSnapshots[index].data() : {};
    let message = shared;
    if (itemsByUserId) {
      const allowed = (itemsByUserId.get(uid) || [])
        .filter(item => shouldDeliver(preferences, 'telegram', item.type));
      message = formatTelegramNotification(allowed);
    }
    if (!itemsByUserId && !shouldDeliver(preferences, 'telegram', type)) message = null;
    if (!message) {
      skippedUserIds.push(uid);
      return [];
    }
    if (!connection.chatId) {
      immediateFailures.set(uid, 'Telegram connection has no chat id');
      return [];
    }
    return [{ uid, promise: sendFormattedTelegramMessage(connection.chatId, message) }];
  });
  const results = await Promise.allSettled(deliveries.map(delivery => delivery.promise));
  const failedUserIds = [...immediateFailures.keys()];
  const errorsByUserId = Object.fromEntries(immediateFailures);
  let delivered = 0;
  for (const [index, item] of results.entries()) {
    if (item.status === 'rejected') {
      console.warn('[telegram] Delivery failed:', item.reason?.message || item.reason);
      const uid = deliveries[index].uid;
      failedUserIds.push(uid);
      errorsByUserId[uid] = String(item.reason?.message || item.reason || 'Telegram delivery failed');
    } else {
      delivered += 1;
    }
  }
  return {
    delivered,
    attempted: deliveries.length + immediateFailures.size,
    failedUserIds,
    errorsByUserId,
    skippedUserIds,
  };
}
