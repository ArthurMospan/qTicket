import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest, authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { refuseWithoutCapability } from '@/lib/server/planLimits';
import {
  ensureTelegramWebhook,
  telegramStatus,
  telegramTokenId,
} from '@/lib/server/telegram';

export async function GET(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    const snapshot = await getAdminDb().collection('users').doc(authorization.user.uid)
      .collection('private').doc('telegram').get();
    const status = telegramStatus();
    return NextResponse.json({
      ...status,
      connected: snapshot.exists && Boolean(snapshot.data().chatId),
      chatTitle: snapshot.exists ? snapshot.data().chatTitle || '' : '',
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'telegram status', fallbackMessage: 'Не вдалося перевірити Telegram' });
  }
}

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId.trim() : '';
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    const status = telegramStatus();
    if (!status.configured) return NextResponse.json({ error: 'Telegram bot is not configured' }, { status: 503 });
    // Linking is «Інтеграції». Unlinking (DELETE) never asks: a workspace must
    // always be able to close a door it opened, whatever it is paying.
    const refusal = await refuseWithoutCapability(getAdminDb(), organizationId, 'integrations');
    if (refusal) return refusal;

    await ensureTelegramWebhook();
    const token = randomBytes(24).toString('base64url');
    await getAdminDb().collection('telegramConnectTokens').doc(telegramTokenId(token)).set({
      type: 'user',
      userId: authorization.user.uid,
      organizationId,
      expiresAt: Timestamp.fromMillis(Date.now() + 15 * 60 * 1000),
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({
      link: `https://t.me/${status.username}?start=qt_${token}`,
      expiresInSeconds: 900,
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'telegram connect', fallbackMessage: 'Не вдалося підключити Telegram' });
  }
}

export async function DELETE(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    await getAdminDb().collection('users').doc(authorization.user.uid)
      .collection('private').doc('telegram').delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, { context: 'telegram disconnect', fallbackMessage: 'Не вдалося відключити Telegram' });
  }
}
