import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  sendTelegramMessage,
  telegramStartPayload,
  telegramTokenId,
  validTelegramWebhookSecret,
} from '@/lib/server/telegram';

/**
 * One command, and it is the handshake.
 *
 * QuickTeam's webhook also understands a task command in a group chat and files
 * an issue from it. That half is deliberately absent here: only a client opens
 * a request, from their own project, so a desk can always say who asked for
 * what — and a room in a group chat is not a client. Anything this endpoint
 * does not recognise is answered «ok» and dropped, because Telegram retries
 * whatever is not.
 */
async function connectPrivateChat(message, payload) {
  if (message.chat?.type !== 'private' || !payload?.startsWith('qt_')) return false;
  const token = payload.slice(3);
  const db = getAdminDb();
  const tokenRef = db.collection('telegramConnectTokens').doc(telegramTokenId(token));
  // A transaction, so one token cannot be spent twice by two updates arriving
  // together — the same reason an invite link is claimed in one.
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(tokenRef);
    const data = snapshot.exists ? snapshot.data() : null;
    if (!data || data.type !== 'user' || data.expiresAt?.toMillis?.() < Date.now()) {
      throw new Error('LINK_EXPIRED');
    }
    transaction.set(
      db.collection('users').doc(data.userId).collection('private').doc('telegram'),
      {
        provider: 'telegram',
        chatId: String(message.chat.id),
        chatTitle: message.chat.username
          ? `@${message.chat.username}`
          : message.chat.first_name || 'Telegram',
        telegramUserId: String(message.from?.id || ''),
        telegramUsername: message.from?.username || '',
        connectedAt: FieldValue.serverTimestamp(),
      },
    );
    transaction.delete(tokenRef);
  });
  await sendTelegramMessage(
    message.chat.id,
    '✅ Telegram підключено. Сповіщення qTicket надходитимуть сюди — які саме, вибирається в «Налаштування» → «Сповіщення».',
  ).catch(error => console.warn('[telegram] connect confirmation failed:', error.message));
  return true;
}

export async function POST(request) {
  try {
    const secret = request.headers.get('x-telegram-bot-api-secret-token') || '';
    if (!validTelegramWebhookSecret(secret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const update = await readJsonBody(request);
    const message = update.message;
    if (!message?.text || !message.chat?.id) return NextResponse.json({ ok: true });

    const start = telegramStartPayload(message.text);
    if (start !== null) {
      try {
        await connectPrivateChat(message, start);
      } catch (error) {
        if (error.message === 'LINK_EXPIRED') {
          await sendTelegramMessage(
            message.chat.id,
            'Посилання вже використане або протерміноване. Створіть нове в qTicket: «Налаштування» → «Сповіщення».',
          ).catch(() => {});
          return NextResponse.json({ ok: true });
        }
        throw error;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'telegram webhook',
      fallbackMessage: 'Telegram webhook failed',
    });
  }
}
