'use client';

// The files on a chat message.
//
// Three kinds of file get a treatment of their own here, and the rule is the
// same one the task's attachment row follows — a task where you can hear a
// voice note and a chat where you cannot is the kind of difference nobody can
// explain to a user:
//
//   • a picture shows the picture;
//   • a video shows its own first frame, with the play badge over it, and opens
//     in the viewer where it actually plays;
//   • a sound file plays right here, in the message, with no viewer at all.
//
// Everything else is a name, a size and its family's glyph — a PDF red, a
// spreadsheet green, an archive amber — decided once by `FileThumb`.

import { useEffect, useState } from 'react';
import { Eye, Play, X } from 'lucide-react';
import AudioPlayer from '@/components/ui/Attachments/AudioPlayer';
import FileThumb from '@/components/ui/Attachments/FileThumb';
import {
  attachmentKind,
  attachmentMetaLabel,
} from '@/lib/utils/attachmentKinds.mjs';
import { useChatAttachmentAccess } from '@/lib/hooks/useChatAttachmentAccess';

function AttachmentTile({
  attachment,
  previewUrl,
  onOpen,
  onRemove,
  compact = false,
  dark = false,
}) {
  const privateAccess = useChatAttachmentAccess(attachment);
  const url = previewUrl || privateAccess.url;
  const kind = attachmentKind({ ...attachment, previewUrl: url });
  const name = attachment?.name || 'Файл';
  const metaLabel = attachmentMetaLabel(attachment, kind);
  const open = () => onOpen?.({
    ...attachment,
    previewUrl: url,
    secureDownloadUrl: privateAccess.downloadUrl,
  });

  const removeButton = onRemove ? (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Прибрати ${name}`}
      className={`shrink-0 rounded-[6px] p-1 ${dark ? 'text-white/55 hover:bg-white/10 hover:text-white' : 'text-faint hover:bg-canvas hover:text-ink'}`}
    >
      <X size={13} />
    </button>
  ) : null;

  // ── Sound: no tile, no viewer, just the player ────────────────────────────
  if (kind === 'audio' && url) {
    return (
      <div
        className={`w-full rounded-[10px] border px-2.5 py-2 ${
          dark
            ? 'border-white/10 bg-white/10'
            : 'border-black/[0.06] bg-white/80'
        }`}
      >
        <AudioPlayer
          src={url}
          title={name}
          meta={metaLabel}
          dark={dark}
          actions={removeButton}
        />
      </div>
    );
  }

  // ── Picture and video: the file is its own preview ────────────────────────
  if ((kind === 'image' || kind === 'video') && url) {
    const content = (
      <>
        <span className={`relative block w-full overflow-hidden bg-canvas ${compact ? 'h-[96px]' : 'h-[140px]'}`}>
          {kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            // `#t=0.1` steps past the black leader frame most encoders write, so
            // the tile shows the video rather than a black rectangle.
            <video
              src={`${url}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          )}
          {!onRemove && (
            <span className={`absolute inset-0 flex items-center justify-center transition-all ${
              kind === 'video'
                ? 'bg-black/20'
                : 'bg-black/0 opacity-0 group-hover:bg-black/10 group-hover:opacity-100'
            }`}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white">
                {kind === 'video'
                  ? <Play size={15} fill="currentColor" className="ml-[2px]" />
                  : <Eye size={15} />}
              </span>
            </span>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Прибрати ${name}`}
              className="absolute right-2 top-2 z-10 rounded-[7px] bg-black/55 p-1.5 text-white hover:bg-black/70"
            >
              <X size={14} />
            </button>
          )}
        </span>
        <span className={`flex items-center gap-2 px-3 py-2 ${dark ? 'bg-white/10' : 'bg-white/90'}`}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold">{name}</span>
            <span className={`block text-[10px] ${dark ? 'text-white/55' : 'text-faint'}`}>{metaLabel}</span>
          </span>
        </span>
      </>
    );
    const className = `group block w-full overflow-hidden rounded-[10px] border text-left transition-colors ${
      dark
        ? 'border-white/10 text-white hover:border-white/20'
        : 'border-black/[0.06] text-ink hover:border-faint'
    }`;

    return onRemove
      ? <div className={className}>{content}</div>
      : (
        <button type="button" onClick={open} className={className} aria-label={`Переглянути ${name}`}>
          {content}
        </button>
      );
  }

  // ── Everything else: the typed row ────────────────────────────────────────
  const content = (
    <>
      <FileThumb attachment={attachment} previewUrl={url} density="sm" dark={dark} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-semibold">{name}</span>
        <span className={`block truncate text-[10px] ${dark ? 'text-white/55' : 'text-faint'}`}>
          {metaLabel}
        </span>
      </span>
      {removeButton}
    </>
  );
  const className = `flex min-w-0 w-full items-center gap-2.5 rounded-[8px] border border-transparent px-2 py-2 text-left transition-colors ${
    dark
      ? 'bg-white/10 text-white hover:bg-white/15'
      : 'bg-white/80 text-ink hover:border-faint hover:bg-white'
  }`;

  return url && !onRemove
    ? (
      <button type="button" onClick={open} className={className} aria-label={`Переглянути ${name}`}>
        {content}
      </button>
    )
    : <div className={className}>{content}</div>;
}

function PendingAttachment({ file, onRemove, compact, progress }) {
  // A picture and a sound are worth resolving before the message is sent: you
  // can see what you picked and hear the voice note back. A video is not — the
  // browser has to decode it to paint one frame, and a composer holding four
  // clips would decode four videos for four thumbnails nobody asked for. Its
  // typed glyph says what it is until it is sent.
  const [previewUrl] = useState(() => (
    /^(?:image|audio)\//.test(file?.type || '') ? URL.createObjectURL(file) : ''
  ));

  useEffect(() => {
    if (!previewUrl) return undefined;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const uploading = typeof progress === 'number';
  return (
    <div className="relative min-w-0">
      <AttachmentTile
        attachment={file}
        previewUrl={previewUrl}
        onRemove={uploading ? null : onRemove}
        compact={compact}
      />
      {/* Real bytes, not a fabricated crawl: `uploadFile` reports the upload's
          own progress and this is where it lands. A message with a photo on it
          used to sit there with nothing moving, which reads as a hang. */}
      {uploading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-[10px] bg-white/85 backdrop-blur-[2px]">
          <span className="text-[11px] font-semibold text-ink">{Math.round(progress)}%</span>
          <span className="h-1 w-2/3 overflow-hidden rounded-full bg-black/10">
            <span
              className="block h-full rounded-full bg-ink transition-[width] duration-200"
              style={{ width: `${Math.max(3, Math.min(100, progress))}%` }}
            />
          </span>
        </div>
      )}
    </div>
  );
}

// Where a file is being shown, and therefore how. This used to be four
// `className` overrides at four call sites — `max-w-[280px]` in the task chat,
// `max-w-[260px] sm:grid-cols-1` in a thread, `max-w-none sm:grid-cols-1` in the
// materials list, nothing at all in the workspace chat — so the same PNG was a
// 140px tile in one chat, a 96px tile squeezed into half of 280px in the next,
// and a full-width row in the third. A file on a message looks like a file on a
// message, wherever the message is.
const ATTACHMENT_CONTEXTS = {
  message: { grid: 'mt-2 w-full max-w-[420px] gap-1.5', compact: false, columns: 2 },
  panel: { grid: 'mt-0 w-full gap-1.5', compact: true, columns: 1 },
};

/**
 * The files attached to a sent message, as a grid of tiles.
 *
 * @param {object[]} props.attachments The stored files.
 * @param {(attachment) => void} props.onOpen Opens one in the viewer.
 * @param {'message'|'panel'} props.context Where this is being shown; picks the tile size and the columns.
 * @param {boolean} props.dark Inverted tiles, for a message bubble on a dark surface.
 * @param {string} props.className Placement in the parent only.
 */
export function ChatAttachmentList({
  attachments = [],
  onOpen,
  context = 'message',
  dark = false,
  className = '',
}) {
  if (attachments.length === 0) return null;
  const preset = ATTACHMENT_CONTEXTS[context] || ATTACHMENT_CONTEXTS.message;
  // One file takes the whole width. Left in a two-column grid it sat in the
  // left half with an empty half beside it, which reads as a file that failed
  // to load rather than as the only file on the message.
  const columns = preset.columns === 2 && attachments.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1';
  return (
    <div className={`grid min-w-0 grid-cols-1 ${preset.grid} ${columns} ${className}`}>
      {attachments.map((attachment, index) => (
        <AttachmentTile
          key={`${attachment.chatAttachmentKey || attachment.name || 'file'}-${index}`}
          attachment={attachment}
          onOpen={onOpen}
          compact={preset.compact}
          dark={dark}
        />
      ))}
    </div>
  );
}

/**
 * The same grid, before the message is sent: local files that can still be
 * removed. Separate from `ChatAttachmentList` because a picked `File` and a
 * stored attachment are different things, and only one of them can be dropped.
 *
 * @param {File[]} props.files Files picked but not yet uploaded.
 * @param {(index: number) => void} props.onRemove Drops one from the selection.
 * @param {boolean} props.compact Denser tiles.
 * @param {Record<number, number>} props.progress Percent uploaded, by index, while the message is being sent.
 * @param {string} props.className Placement in the parent only.
 */
export function PendingChatAttachments({
  files = [],
  onRemove,
  compact = true,
  progress = {},
  className = '',
}) {
  if (files.length === 0) return null;
  return (
    <div className={`grid grid-cols-1 gap-1.5 sm:grid-cols-2 ${className}`}>
      {files.map((file, index) => (
        <PendingAttachment
          key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
          file={file}
          compact={compact}
          progress={progress[index]}
          onRemove={() => onRemove(index)}
        />
      ))}
    </div>
  );
}
