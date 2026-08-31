import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  ensureTelegramWebhook,
  telegramStatus,
  telegramTokenId,
} from '@/lib/server/telegram';

/**
 * The Telegram channel, per person.
 *
 * There is no organization scope on any of this, and that is deliberate:
 * QuickTeam's version gates linking behind a paid «Інтеграції» capability
 * because its bot also files tasks into a workspace. qTicket's bot only
 * delivers notifications to the person who linked it, so the only authority
 * needed is being that person — and there is no qTicket plan to ask anyway.
 */
export async function GET(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const snapshot = await getAdminDb().collection('users').doc(authorization.user.uid)
      .collection('private').doc('telegram').get();
    return NextResponse.json({
      ...telegramStatus(),
      connected: snapshot.exists && Boolean(snapshot.data().chatId),
      chatTitle: snapshot.exists ? snapshot.data().chatTitle || '' : '',
    });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'telegram status',
      fallbackMessage: 'Не вдалося перевірити Telegram',
    });
  }
}

export async function POST(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const status = telegramStatus();
    if (!status.configured) {
      return NextResponse.json({ error: 'Telegram bot is not configured' }, { status: 503 });
    }
    // Accepted and ignored: the client sends a body so the two ends agree on a
    // shape, and nothing in it may decide anything.
    await readJsonBody(request).catch(() => ({}));

    await ensureTelegramWebhook();
    // A bearer secret, stored by hash and short-lived. Whoever holds the raw
    // token can attach *their* Telegram chat to *this* account, so it is minted
    // on demand, dies in fifteen minutes, and is deleted the moment it is spent.
    const token = randomBytes(24).toString('base64url');
    await getAdminDb().collection('telegramConnectTokens').doc(telegramTokenId(token)).set({
      type: 'user',
      userId: authorization.user.uid,
      expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({
      link: `https://t.me/${status.username}?start=qt_${token}`,
      expiresInSeconds: 900,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'telegram connect',
      fallbackMessage: 'Не вдалося підключити Telegram',
    });
  }
}

// Unlinking never asks anything: an account must always be able to close a door
// it opened.
export async function DELETE(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    await getAdminDb().collection('users').doc(authorization.user.uid)
      .collection('private').doc('telegram').delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'telegram disconnect',
      fallbackMessage: 'Не вдалося відключити Telegram',
    });
  }
}
