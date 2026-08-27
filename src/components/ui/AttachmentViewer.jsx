'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useModalFocus } from '@/lib/hooks/useModalFocus';
import FileThumb from '@/components/ui/Attachments/FileThumb';
import {
  attachmentKind,
  attachmentKindLabel,
  attachmentMetaLabel,
  attachmentUrl,
} from '@/lib/utils/attachmentKinds.mjs';

// Cloudinary forces a download (rather than inline view) when the delivery URL
// carries the fl_attachment flag. For any other host we fall back to the raw
// URL + the download attribute.
function downloadUrlFor(url) {
  if (typeof url === 'string' && url.includes('/upload/') && url.includes('res.cloudinary.com')) {
    return url.replace('/upload/', '/upload/fl_attachment/');
  }
  return url;
}

/**
 * Full-screen viewer for one attachment — picture, PDF, video, plain text, or
 * the download card for anything the browser cannot render.
 *
 * Sound never reaches here: an audio attachment plays in the row or the message
 * it is attached to, and a black full-screen overlay to hear twelve seconds of
 * voice was the interaction this viewer got most obviously wrong.
 *
 * @param {object} props.attachment The file to show; `null` closes the viewer.
 * @param {() => void} props.onClose Closes it.
 */
export default function AttachmentViewer({ attachment, onClose }) {
  const [scale, setScale] = useState(1);
  const url = attachmentUrl(attachment);
  const kind = useMemo(() => attachmentKind(attachment), [attachment]);
  const name = attachment?.name || 'Вкладення';
  const dialogRef = useModalFocus({ isOpen: Boolean(attachment && url), onClose });

  useEffect(() => {
    if (!attachment) return undefined;
    const handleKeyDown = event => {
      if (kind === 'image' && (event.key === '+' || event.key === '=')) setScale(value => Math.min(3, value + 0.25));
      if (kind === 'image' && event.key === '-') setScale(value => Math.max(0.5, value - 0.25));
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [attachment, kind, onClose]);

  if (!attachment || !url || typeof document === 'undefined') return null;

  // Text and source files are the second most common thing a colleague drops on
  // a task after a picture, and they used to land on the "cannot show this"
  // card. The browser renders both as text; the frame is all it needed.
  const rendersInFrame = kind === 'pdf' || kind === 'text' || kind === 'code';

  return createPortal(
    <div
      data-ui-overlay="media-viewer"
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[200] flex flex-col bg-black/85"
      role="dialog"
      aria-modal="true"
      aria-label={`Перегляд: ${name}`}
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-black/35 px-4 text-white">
        <FileThumb attachment={attachment} previewUrl={url} density="sm" dark />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold">{name}</span>
          <span className="block text-[10px] text-white/50">{attachmentMetaLabel(attachment, kind)}</span>
        </span>
        {kind === 'image' && (
          <div className="flex items-center gap-1" aria-label="Масштаб зображення">
            <button data-ui-control="media-action" type="button" onClick={() => setScale(value => Math.max(0.5, value - 0.25))} className="rounded-[7px] p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Зменшити"><ZoomOut size={17} /></button>
            <button
              type="button"
              onClick={() => setScale(1)}
              disabled={scale === 1}
              className="min-w-12 rounded-[7px] px-2 py-1.5 text-[11px] font-semibold text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-default disabled:text-white/35 disabled:hover:bg-transparent"
              aria-label={`Поточний масштаб ${Math.round(scale * 100)}%. Скинути до 100%`}
              title={scale === 1 ? 'Зображення вже має масштаб 100%' : 'Скинути масштаб до 100%'}
            >
              {Math.round(scale * 100)}%
            </button>
            <button data-ui-control="media-action" type="button" onClick={() => setScale(value => Math.min(3, value + 0.25))} className="rounded-[7px] p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Збільшити"><ZoomIn size={17} /></button>
          </div>
        )}
        <a href={attachment.secureDownloadUrl || downloadUrlFor(url)} download={name} className="rounded-[7px] p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Завантажити" title="Завантажити"><Download size={17} /></a>
        <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-[7px] p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Відкрити оригінал" title="Відкрити оригінал"><ExternalLink size={17} /></a>
        <button data-ui-control="media-action" type="button" onClick={onClose} className="rounded-[7px] p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Закрити"><X size={19} /></button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
        {kind === 'image' && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={name} className="max-h-full max-w-full select-none object-contain transition-transform duration-150" style={{ transform: `scale(${scale})` }} />
        )}
        {rendersInFrame && <iframe src={url} title={name} className="h-full w-full max-w-6xl rounded-[8px] bg-white" />}
        {kind === 'video' && <video src={url} controls autoPlay className="max-h-full max-w-full" />}
        {kind === 'audio' && <audio src={url} controls autoPlay className="w-full max-w-xl" />}
        {!rendersInFrame && kind !== 'image' && kind !== 'video' && kind !== 'audio' && (
          // The honest card: the browser will not render this one, so say what
          // it is instead of drawing a generic page and hoping.
          <div data-ui-surface="local" className="flex max-w-sm flex-col items-center gap-4 rounded-[16px] bg-white p-8 text-center">
            <FileThumb attachment={attachment} density="lg" />
            <div>
              <p className="max-w-full break-words text-[14px] font-semibold text-ink">{name}</p>
              <p className="mt-1 text-[11px] text-muted">
                {attachmentKindLabel(kind)} — його не можна показати тут
              </p>
            </div>
            <a href={attachment.secureDownloadUrl || downloadUrlFor(url)} download={name} className="inline-flex items-center gap-2 rounded-[7px] bg-ink px-4 py-2 text-[13px] font-semibold text-white"><Download size={15} /> Завантажити</a>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
