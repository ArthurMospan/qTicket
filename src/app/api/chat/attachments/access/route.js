import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { isOrganizationChatStoragePath } from '@/lib/utils/uploadPaths.mjs';
import { canAccessChatChannel } from '@/lib/utils/workspaceChat.mjs';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_RESOURCE_TYPES = new Set(['image', 'video', 'raw']);
const SAFE_DOCUMENT_ID = /^[^/\0]{1,512}$/;
const SAFE_FORMAT = /^[a-zA-Z0-9]{1,12}$/;
const ACCESS_LIFETIME_SECONDS = 5 * 60;

function validDocumentId(value) {
  return typeof value === 'string' && SAFE_DOCUMENT_ID.test(value);
}

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const {
      organizationId,
      channelId,
      messageId,
      replyId = '',
      attachmentIndex,
    } = body;

    if (
      !validDocumentId(organizationId)
      || !validDocumentId(channelId)
      || !validDocumentId(messageId)
      || (replyId && !validDocumentId(replyId))
      || !Number.isInteger(attachmentIndex)
      || attachmentIndex < 0
      || attachmentIndex > 49
    ) {
      return NextResponse.json({ error: 'Invalid attachment reference' }, { status: 400 });
    }

    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }
    if (!(await enforceRateLimit('chat-attachment-access', authorization.user.uid, 300, 60))) {
      return NextResponse.json({ error: 'Too many attachment requests' }, { status: 429 });
    }

    const db = getAdminDb();
    const channelRef = db.collection('organizations').doc(organizationId)
      .collection('channels').doc(channelId);
    const parentMessageRef = channelRef.collection('messages').doc(messageId);
    const attachmentMessageRef = replyId
      ? parentMessageRef.collection('replies').doc(replyId)
      : parentMessageRef;
    const channelSnapshot = await channelRef.get();
    if (!channelSnapshot.exists) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }
    const channel = { ...channelSnapshot.data(), id: channelSnapshot.id };
    if (!canAccessChatChannel(channel, authorization.user.uid)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Do not even read message content until room access has been proved.
    const messageSnapshot = await attachmentMessageRef.get();
    if (!messageSnapshot.exists) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }
    const attachment = messageSnapshot.data()?.attachments?.[attachmentIndex];
    if (
      !attachment
      || attachment.deliveryType !== 'authenticated'
      || !isOrganizationChatStoragePath(attachment.storagePath, organizationId)
      || !ALLOWED_RESOURCE_TYPES.has(attachment.resourceType)
      || !SAFE_FORMAT.test(attachment.format || '')
    ) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    const expiresAt = Math.floor(Date.now() / 1000) + ACCESS_LIFETIME_SECONDS;
    const options = {
      resource_type: attachment.resourceType,
      type: 'authenticated',
      expires_at: expiresAt,
    };
    const url = cloudinary.utils.private_download_url(
      attachment.storagePath,
      attachment.format,
      { ...options, attachment: false },
    );
    const downloadUrl = cloudinary.utils.private_download_url(
      attachment.storagePath,
      attachment.format,
      { ...options, attachment: true },
    );

    return NextResponse.json(
      { url, downloadUrl, expiresAt },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'chat-attachment-access',
      fallbackMessage: 'Не вдалося відкрити вкладення',
    });
  }
}
