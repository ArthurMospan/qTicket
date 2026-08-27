// src/app/api/upload/delete/route.js
// Deletes an asset from Cloudinary so removed files don't linger in storage.
// Requires the API secret, so it must run server-side.
//
// Authorization: proving you are signed in is NOT enough — that would let any
// user destroy any other tenant's attachments, avatars and materials by naming
// their public_id. The organization is read out of the path itself and the
// caller must be a member of it, so a request can never reach outside the
// caller's own tenants.
import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { authenticateRequest, enforceRateLimit } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  callerBelongsToPathOrganization,
  isOrganizationChatStoragePath,
  isSafeStoragePath,
  organizationIdFromPath,
} from '@/lib/server/uploadPaths';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const ALLOWED_RESOURCE_TYPES = new Set(['image', 'video', 'raw']);
const ALLOWED_DELIVERY_TYPES = new Set(['upload', 'authenticated']);

export async function POST(req) {
  try {
    const authorization = await authenticateRequest(req);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('upload-delete', authorization.user.uid, 60, 60))) {
      return NextResponse.json({ error: 'Too many delete requests' }, { status: 429 });
    }

    const { storagePath, resourceType, deliveryType } = await readJsonBody(req);
    if (!isSafeStoragePath(storagePath)) {
      return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 });
    }

    const organizationId = organizationIdFromPath(storagePath);
    if (!organizationId) {
      // Legacy uploads that predate organization-scoped folders carry no proof
      // of ownership, so nobody may delete them through this route.
      return NextResponse.json({ error: 'Storage path is not organization-scoped' }, { status: 403 });
    }
    if (!(await callerBelongsToPathOrganization(authorization.user.uid, organizationId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const type = ALLOWED_RESOURCE_TYPES.has(resourceType) ? resourceType : 'image';
    const assetDeliveryType = ALLOWED_DELIVERY_TYPES.has(deliveryType) ? deliveryType : 'upload';
    if (
      assetDeliveryType === 'authenticated'
      && !isOrganizationChatStoragePath(storagePath, organizationId)
    ) {
      return NextResponse.json({ error: 'Invalid authenticated asset path' }, { status: 400 });
    }
    const result = await cloudinary.uploader.destroy(storagePath, {
      resource_type: type,
      type: assetDeliveryType,
      invalidate: true,
    });
    // Cloudinary returns { result: 'ok' } or 'not found'. Treat a missing
    // asset as success — the goal (it's gone) is already met.
    if (result.result !== 'ok' && result.result !== 'not found') {
      return NextResponse.json({ error: 'Не вдалося видалити файл' }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'upload-delete',
      fallbackMessage: 'Не вдалося видалити файл',
    });
  }
}
