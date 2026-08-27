import { uploadFileToCloudinary } from '@/lib/services/fileUpload';

/**
 * Uploads a file to Cloudinary (replacing failing Firebase Storage).
 * @param {File} file - The file to upload
 * @param {string} path - The path prefix/folder (e.g. `organizations/orgId/attachments`)
 * @param {Function} onProgress - Optional callback for upload progress (0 to 100)
 * @returns {Promise<Object>} Object containing file metadata (name, url, size, type)
 */
export async function uploadFile(file, path, onProgress = null) {
  if (!file) throw new Error('No file provided');
  if (!path) throw new Error('An organization-scoped upload path is required');

  // Convert the storage path/prefix to a Cloudinary folder structure
  const folder = `quickteam/${path.replace(/^\/+|\/+$/g, '')}`;

  try {
    // Real byte-level progress from the upload itself, not a fabricated 20→100.
    const { downloadUrl, storagePath, resourceType, deliveryType, format } =
      await uploadFileToCloudinary(file, folder, onProgress);
    if (onProgress) onProgress(100);

    return {
      name: file.name,
      // Authenticated Cloudinary URLs are deliberately not persisted. Chat
      // reads obtain a short-lived signed URL only after channel authorization.
      url: deliveryType === 'authenticated' ? '' : downloadUrl,
      size: file.size,
      type: file.type,
      storagePath,
      resourceType,
      deliveryType,
      format,
    };
  } catch (error) {
    console.error('Error in uploadFile helper via Cloudinary:', error);
    throw error;
  }
}
