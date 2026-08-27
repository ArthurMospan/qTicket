// src/app/api/upload/sign/route.js
import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { authenticateRequest, enforceRateLimit } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  callerBelongsToPathOrganization,
  isOrganizationChatUploadFolder,
  isSafeUploadFolder,
  organizationIdFromPath,
} from '@/lib/server/uploadPaths';
import { uploadFilePolicy } from '@/lib/utils/uploadPolicy.mjs';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function POST(req) {
  try {
    const authorization = await authenticateRequest(req);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('upload', authorization.user.uid, 30, 60))) {
      return NextResponse.json({ error: 'Too many upload requests' }, { status: 429 });
    }

    const { params } = await readJsonBody(req);
    const folder = params?.folder;
    const publicId = params?.public_id;
    const filePolicy = uploadFilePolicy(params?.file);
    if (
      !isSafeUploadFolder(folder) ||
      typeof publicId !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,160}$/.test(publicId) ||
      filePolicy.error
    ) {
      return NextResponse.json({
        error: filePolicy.error || 'Invalid upload parameters',
      }, { status: 400 });
    }

    // Signing an organization folder for a non-member would let one tenant
    // write into another tenant's namespace, which the delete route then
    // treats as owned by that other tenant.
    const organizationId = organizationIdFromPath(folder);
    if (!organizationId) {
      return NextResponse.json({ error: 'Upload folder is not organization-scoped' }, { status: 403 });
    }
    if (!(await callerBelongsToPathOrganization(authorization.user.uid, organizationId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const timestamp = Math.round(new Date().getTime() / 1000);

    // Chat material is confidential workspace content. Cloudinary's
    // authenticated delivery type keeps both originals and derivations closed
    // until our channel-authorized access route issues a short-lived URL.
    const deliveryType = isOrganizationChatUploadFolder(folder, organizationId)
      ? 'authenticated'
      : 'upload';
    // The size the browser declared, and the size it actually sends.
    //
    // `uploadFilePolicy` above checks `params.file`, which is `{ name, size,
    // type }` as reported by the browser — so a client that says «1 KB» and
    // sends 500 MB passes every check made here and is accepted by Cloudinary,
    // because the signature covers the format and not the size. One member can
    // exhaust a free-tier cloud that way, and what breaks then is everybody's
    // avatars, logos and chat attachments rather than their own upload.
    //
    // Cloudinary has no per-request size parameter; the ceiling lives on an
    // upload preset, and a signed `upload_preset` is what binds it to this
    // signature. Naming one is a console step, so this is conditional: without
    // CLOUDINARY_UPLOAD_PRESET the behaviour is exactly what it was, and with it
    // the declared size stops being the only thing between us and the bill.
    // See docs/MIGRATIONS.md for the four clicks that create it.
    const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim() || '';
    const signedParams = {
      folder,
      public_id: publicId,
      overwrite: false,
      timestamp,
      allowed_formats: filePolicy.value.allowedFormats.join(','),
      ...(uploadPreset ? { upload_preset: uploadPreset } : {}),
      ...(deliveryType === 'authenticated' ? { type: deliveryType } : {}),
    };
    const signature = cloudinary.utils.api_sign_request(
      signedParams,
      process.env.CLOUDINARY_API_SECRET
    );

    return NextResponse.json({
      signature,
      timestamp,
      overwrite: false,
      ...(uploadPreset ? { uploadPreset } : {}),
      deliveryType,
      resourceType: filePolicy.value.resourceType,
      allowedFormats: filePolicy.value.allowedFormats,
      apiKey: process.env.CLOUDINARY_API_KEY,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'upload-sign',
      fallbackMessage: 'Не вдалося підготувати завантаження',
    });
  }
}
