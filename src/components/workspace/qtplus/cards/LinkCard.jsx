'use client';
import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { safeExternalUrl } from '@/lib/utils/externalUrls.mjs';

/**
 * OG-превʼю показуємо лише те, що портал УЖЕ зберіг у матеріалі.
 * Портал, не знайшовши ogImage, фетчить /api/link-preview і ПИШЕ результат назад
 * у матеріал — нам це заборонено (read-only). Деградуємо до іконки й домену.
 */
export default function LinkCard({ view }) {
  const [imgFailed, setImgFailed] = useState(false);
  const { domain, image, title, description } = view.link;
  const url = safeExternalUrl(view.url);
  const previewImage = safeExternalUrl(image);

  if (!url) {
    return (
      <div data-ui-surface="local" className="rounded-[12px] border border-line bg-surface px-3 py-2">
        <p className="text-[13px] text-ink font-medium truncate">{title}</p>
        <p className="text-[12px] text-muted">Посилання недоступне</p>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="rounded-[12px] border border-line bg-surface overflow-hidden block hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)] transition-shadow"
    >
      <div className="h-[160px] bg-canvas flex items-center justify-center overflow-hidden">
        {previewImage && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- link previews point at arbitrary third-party hosts, which next/image cannot whitelist
          <img src={previewImage} alt="" onError={() => setImgFailed(true)} className="w-full h-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-[10px] bg-surface flex items-center justify-center">
            <Link2 size={18} className="text-ink" />
          </div>
        )}
      </div>
      <div className="px-3 py-2">
        <p className="text-[13px] text-ink font-medium truncate">{title}</p>
        <p className="text-[11px] text-muted truncate">{description || domain}</p>
      </div>
    </a>
  );
}
