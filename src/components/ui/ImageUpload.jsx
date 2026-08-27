'use client';
import { useState, useRef } from 'react';
import { Upload, Loader2, Trash2 } from 'lucide-react';
import {
  deleteFileFromCloudinary,
  uploadFileToCloudinary,
} from '@/lib/services/fileUpload';
import {
  organizationImageFolder,
  organizationOwnedImageAsset,
} from '@/lib/utils/cloudinaryAssets.mjs';
import {
  IMAGE_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_FORMATS,
  MAX_UPLOAD_MB,
  RECOMMENDED_IMAGE_MIN_PX,
} from '@/lib/utils/uploadPolicy.mjs';

/**
 * Picks an image, uploads it, and shows what is currently set — the workspace
 * logo and the project avatar both go through here.
 *
 * @param {string} props.value URL of the image already stored.
 * @param {(url: string, asset: object) => void} props.onChange Persists the URL and its storage metadata.
 * @param {(message: string) => void} props.onError Fires when the upload fails, with a message to show.
 * @param {string} props.organizationId Organization that owns the Cloudinary folder.
 * @param {'avatars'|'logos'} props.kind Which organization image folder receives the upload.
 * @param {string} props.storagePath Cloudinary public id saved beside the URL.
 * @param {'image'|'video'|'raw'} props.resourceType Cloudinary resource type saved beside the URL.
 * @param {string} props.label Caption above the control.
 * @param {boolean} props.showLabel Whether that caption is drawn.
 * @param {boolean} props.showHint Whether the size and format hint is drawn.
 * @param {'dark'|'light'} props.theme Which surface it sits on; onboarding is dark, settings is light.
 * @param {string} props.className Placement in the parent only.
 */
export default function ImageUpload({
  value,
  onChange,
  onError,
  organizationId,
  kind = 'avatars',
  storagePath = '',
  resourceType = 'image',
  className = '',
  label = 'Завантажити логотип',
  showLabel = true,
  showHint = true,
  theme = 'dark',
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);

  const isDark = theme === 'dark';
  const textColor = isDark ? 'text-white' : 'text-ink';
  const subTextColor = isDark ? 'text-white/40' : 'text-muted';
  // A red word sitting under the label was the loudest thing in the row, for
  // the least likely action in it. It is a quiet icon control now, and it only
  // takes a colour when the cursor is on it.
  const removeColor = isDark
    ? 'text-white/40 hover:text-danger-on-dark hover:bg-white/10'
    : 'text-faint hover:text-danger hover:bg-canvas';
  const bgClass = isDark ? 'bg-surface-dark border-white/10 hover:border-white/30' : 'bg-canvas border-line hover:border-faint';
  const iconColor = isDark ? 'text-white/50' : 'text-muted';

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError('');
    try {
      const upload = await uploadFileToCloudinary(
        file,
        organizationImageFolder(organizationId, kind),
      );
      try {
        await onChange(upload.downloadUrl, {
          storagePath: upload.storagePath,
          resourceType: upload.resourceType,
        });
      } catch (error) {
        // The new file has no durable reference when persistence fails.
        await deleteFileFromCloudinary(upload.storagePath, upload.resourceType).catch(() => {});
        throw error;
      }
    } catch (err) {
      console.error(err);
      const message = err.message || 'Помилка завантаження файлу.';
      if (onError) onError(message); else setUploadError(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async () => {
    const asset = organizationOwnedImageAsset({ value, storagePath, resourceType }, organizationId);
    if (!asset) {
      const message = 'Старе зображення ще не перенесено до сховища організації.';
      if (onError) onError(message); else setUploadError(message);
      return;
    }

    setIsRemoving(true);
    setUploadError('');
    try {
      await deleteFileFromCloudinary(asset.storagePath, asset.resourceType);
      await onChange('', { storagePath: '', resourceType: '' });
    } catch (err) {
      console.error(err);
      const message = err.message || 'Не вдалося видалити зображення.';
      if (onError) onError(message); else setUploadError(message);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className={`flex items-center gap-4 ${className}`}>
      <button
        type="button"
        aria-label={label}
        disabled={isUploading || isRemoving}
        className={`relative w-[64px] h-[64px] rounded-full overflow-hidden border flex items-center justify-center shrink-0 cursor-pointer transition-colors ${bgClass}`}
        onClick={() => fileInputRef.current?.click()}
      >
        {isUploading || isRemoving ? (
          <Loader2 className={`w-6 h-6 animate-spin ${iconColor}`} />
        ) : value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="Logo" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
              <Upload className="w-5 h-5 text-white" />
            </div>
          </>
        ) : (
          <Upload className={`w-6 h-6 ${iconColor}`} />
        )}
      </button>

      <div className="flex flex-col gap-1 justify-center">
        {showLabel && <span className={`text-[14px] font-medium ${textColor}`}>{label}</span>}
        {showHint && (
          // What the picker will actually accept, and the size below which the
          // result looks soft. Both are read from the upload policy, so a new
          // format never leaves this line lying.
          <span className={`text-[12px] ${subTextColor}`}>
            {IMAGE_UPLOAD_FORMATS.slice(0, 4).join(', ')} · від {RECOMMENDED_IMAGE_MIN_PX}×{RECOMMENDED_IMAGE_MIN_PX} px · до {MAX_UPLOAD_MB} МБ
          </span>
        )}
        {value && (
          <button
            type="button"
            disabled={isRemoving || isUploading}
            onClick={handleRemove}
            title="Видалити зображення"
            aria-label="Видалити зображення"
            className={`flex h-[28px] w-[28px] items-center justify-center rounded-[8px] transition-colors disabled:opacity-50 ${removeColor}`}
          >
            <Trash2 size={14} />
          </button>
        )}
        {uploadError && (
          <span className="text-[12px] font-medium text-danger">{uploadError}</span>
        )}
      </div>

      <input
        type="file"
        accept={IMAGE_UPLOAD_ACCEPT}
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />
    </div>
  );
}
