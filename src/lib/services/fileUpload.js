'use client';
import { auth } from '@/lib/firebase';
import {
  MAX_UPLOAD_BYTES,
  requireUploadFilePolicy,
} from '@/lib/utils/uploadPolicy.mjs';
// src/lib/services/fileUpload.js

/**
 * Direct Cloudinary Upload
 */
export async function uploadFileToCloudinary(file, folder, onProgress = null) {
  try {
    const policy = requireUploadFilePolicy(file);
    if (!folder) throw new Error('An organization-scoped upload folder is required');
    const ext = policy.extension;
    const baseName = file.name
      .slice(0, -(ext.length + 1))
      .replace(/[^a-zA-Z0-9]/g, '_') || 'file';
    const public_id = `${Date.now()}_${baseName}`;

    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Authentication is required for uploads');

    const signRes = await fetch('/api/upload/sign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        params: {
          folder,
          public_id,
          file: { name: file.name, size: file.size, type: file.type },
        },
      }),
    });

    const signing = await signRes.json().catch(() => ({}));
    if (!signRes.ok) throw new Error(signing.error || 'Failed to get upload signature');
    const {
      signature,
      timestamp,
      apiKey,
      cloudName,
      overwrite,
      deliveryType = 'upload',
      resourceType,
      allowedFormats = [],
      uploadPreset = '',
    } = signing;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', apiKey);
    formData.append('timestamp', timestamp);
    formData.append('signature', signature);
    formData.append('folder', folder);
    formData.append('public_id', public_id);
    formData.append('overwrite', String(overwrite));
    formData.append('allowed_formats', allowedFormats.join(','));
    // Only when the server signed one. The preset carries the size ceiling, and
    // sending a field the signature does not cover is refused by Cloudinary —
    // so this must mirror the server exactly rather than assume either way.
    if (uploadPreset) formData.append('upload_preset', uploadPreset);
    if (deliveryType === 'authenticated') formData.append('type', deliveryType);

    // XHR rather than fetch: it is the only way to observe real upload
    // progress. The previous helper jumped straight from 20% to 100%, so every
    // progress bar in the app was decorative.
    const data = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`);
      if (onProgress) {
        request.upload.onprogress = progressEvent => {
          if (!progressEvent.lengthComputable) return;
          onProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
        };
      }
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          // What the storage said, in words. «Cloudinary upload error: 400 Bad
          // Request» reached the user verbatim, and there is nothing in it that
          // says which file, why, or what to do about it. The pre-flight policy
          // should already have caught the common cause — a file over the real
          // limit — so anything arriving here is genuinely unexpected.
          let detail = '';
          try {
            detail = JSON.parse(request.responseText)?.error?.message || '';
          } catch {
            detail = '';
          }
          reject(new Error(
            detail
              ? `Сховище відхилило файл: ${detail}`
              : `Не вдалося завантажити файл (код ${request.status})`,
          ));
          return;
        }
        try {
          resolve(JSON.parse(request.responseText));
        } catch {
          reject(new Error('Cloudinary returned an unreadable response'));
        }
      };
      request.onerror = () => reject(new Error('Cloudinary upload failed'));
      request.onabort = () => reject(new Error('Cloudinary upload aborted'));
      request.send(formData);
    });
    const uploadedBytes = Number(data.bytes);
    const uploadedFormat = String(data.format || '').toLowerCase();
    if (
      !Number.isSafeInteger(uploadedBytes)
      || uploadedBytes <= 0
      || uploadedBytes > MAX_UPLOAD_BYTES
      || data.resource_type !== resourceType
      || (uploadedFormat && !allowedFormats.includes(uploadedFormat))
    ) {
      await deleteFileFromCloudinary(
        data.public_id,
        data.resource_type || resourceType,
        deliveryType,
      ).catch(() => {});
      throw new Error('Завантажений файл не відповідає дозволеним параметрам');
    }
    let downloadUrl = data.secure_url;
    if (data.resource_type === 'image') {
      downloadUrl = data.secure_url.replace('/upload/', '/upload/f_auto,q_auto/');
    }

    return {
      downloadUrl,
      storagePath: data.public_id,
      resourceType: data.resource_type,
      deliveryType,
      format: data.format || ext || '',
    };
  } catch (err) {
    console.error('Upload Error:', err);
    throw err;
  }
}

/**
 * Deletes a previously uploaded Cloudinary asset via the signed server route.
 * Best-effort: a failure here must not block removing the message itself, so
 * callers may swallow the rejection. Needs the attachment's storagePath
 * (Cloudinary public_id) and resourceType captured at upload time.
 */
export async function deleteFileFromCloudinary(storagePath, resourceType = 'image', deliveryType = 'upload') {
  if (!storagePath) return false;
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Authentication is required to delete files');

  const res = await fetch('/api/upload/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ storagePath, resourceType, deliveryType }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `Cloudinary delete failed: ${res.statusText}`);
  }
  return true;
}
