import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  ensureTelegramWebhook,
  telegramStatus,
  telegramTokenId,
} from '@/lib/server/telegram';

function organizationIdFrom(request) {
  return new URL(request.url).searchParams.get('organizationId')?.trim() || '';
}

export async function GET(request) {
  try {
    const organizationId = organizationIdFrom(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    const snapshot = await getAdminDb().collection('organizations').doc(organizationId)
      .collection('private').doc('telegram').get();
    const data = snapshot.exists ? snapshot.data() : {};
    return NextResponse.json({
      ...telegramStatus(),
      connected: snapshot.exists && Boolean(data.chatId),
      chatTitle: data.chatTitle || '',
      defaultProjectId: data.defaultProjectId || '',
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'telegram group status', fallbackMessage: 'Не вдалося перевірити Telegram-групу' });
  }
}

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId.trim() : '';
    const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    const status = telegramStatus();
    if (!status.configured) return NextResponse.json({ error: 'Telegram bot is not configured' }, { status: 503 });
    const project = await getAdminDb().collection('projects').doc(projectId).get();
    if (!project.exists || project.data().organizationId !== organizationId || project.data().status === 'archived') {
      return NextResponse.json({ error: 'Оберіть активний проєкт цієї організації' }, { status: 400 });
    }

    await ensureTelegramWebhook();
    const token = randomBytes(24).toString('base64url');
    const payload = `qtg_${token}`;
    await getAdminDb().collection('telegramConnectTokens').doc(telegramTokenId(token)).set({
      type: 'organization',
      organizationId,
      projectId,
      createdBy: authorization.user.uid,
      expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({
      addGroupLink: `https://t.me/${status.username}?startgroup=${payload}`,
      command: `/quickteam_connect ${payload}`,
      expiresInSeconds: 1800,
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'telegram group connect', fallbackMessage: 'Не вдалося підготувати Telegram-групу' });
  }
}

export async function DELETE(request) {
  try {
    const organizationId = organizationIdFrom(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    const db = getAdminDb();
    const ref = db.collection('organizations').doc(organizationId).collection('private').doc('telegram');
    const snapshot = await ref.get();
    const batch = db.batch();
    batch.delete(ref);
    if (snapshot.exists && snapshot.data().chatId) {
      batch.delete(db.collection('telegramChats').doc(String(snapshot.data().chatId)));
    }
    await batch.commit();
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, { context: 'telegram group disconnect', fallbackMessage: 'Не вдалося відключити Telegram-групу' });
  }
}
