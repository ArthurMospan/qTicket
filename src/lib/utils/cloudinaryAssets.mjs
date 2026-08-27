import {
  isSafeStoragePath,
  organizationIdFromPath,
} from './uploadPaths.mjs';

const IMAGE_RESOURCE_TYPES = new Set(['image', 'video', 'raw']);

/**
 * Reads the public id and resource type from a Cloudinary delivery URL.
 * Transformations and version segments are deliberately ignored: ownership
 * starts at the `quickteam/` path, which is the same value the delete API
 * validates.
 */
export function cloudinaryAssetFromUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const uploadIndex = segments.indexOf('upload');
  const rootIndex = segments.indexOf('quickteam', uploadIndex + 1);
  if (uploadIndex < 1 || rootIndex < 0) return null;

  const resourceType = IMAGE_RESOURCE_TYPES.has(segments[uploadIndex - 1])
    ? segments[uploadIndex - 1]
    : 'image';
  const pathSegments = segments.slice(rootIndex).map(segment => {
    try { return decodeURIComponent(segment); } catch { return ''; }
  });
  if (pathSegments.some(segment => !segment)) return null;

  // Cloudinary appends a delivery extension for image/video resources even
  // when it is not part of the public id used by the Admin API.
  if (resourceType !== 'raw') {
    pathSegments[pathSegments.length - 1] = pathSegments.at(-1).replace(/\.[A-Za-z0-9]{1,10}$/, '');
  }
  const storagePath = pathSegments.join('/');
  if (!isSafeStoragePath(storagePath)) return null;
  return { storagePath, resourceType };
}

export function organizationImageFolder(organizationId, kind = 'avatars') {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(organizationId || '')) {
    throw new Error('Не вказано коректну організацію для зображення');
  }
  if (kind !== 'avatars' && kind !== 'logos') {
    throw new Error('Некоректний тип зображення');
  }
  return `quickteam/organizations/${organizationId}/${kind}`;
}

export function organizationOwnedImageAsset({ value, storagePath, resourceType }, organizationId) {
  const parsed = storagePath
    ? { storagePath, resourceType: IMAGE_RESOURCE_TYPES.has(resourceType) ? resourceType : 'image' }
    : cloudinaryAssetFromUrl(value);
  if (!parsed || organizationIdFromPath(parsed.storagePath) !== organizationId) return null;
  return parsed;
}
