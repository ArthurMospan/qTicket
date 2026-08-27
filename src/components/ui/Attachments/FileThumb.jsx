'use client';

// ─── UI Kit: File Thumb ──────────────────────────────────────────────────────
// The little square in front of a file's name, and the only thing in the
// product that decides what a file looks like.
//
// It used to be decided three times. The task row drew an <img> for pictures and
// a grey `FileText` for absolutely everything else; the chat tile drew five
// glyphs from a map of its own; the channel's materials list drew whatever the
// chat tile drew. So a .xlsx, a .zip, a .txt and a Keynote deck were the same
// grey page in every one of them, and a video — a file that *has* a picture —
// was a page too.
//
// Here a picture shows its picture, a video shows its own first frame with the
// play badge over it, and everything else gets its family's glyph on its
// family's tint. The geometry and the eleven hues live in `globals.css` under
// `.ui-file-glyph`; this component only decides which of the three it is.

import React from 'react';
import {
  Archive,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileType,
  Film,
  Image as ImageIcon,
  Music2,
  Play,
  Presentation,
} from 'lucide-react';
import { attachmentKind, attachmentUrl, isVisualKind } from '@/lib/utils/attachmentKinds.mjs';

// Which glyph stands for each family. The hue that goes with it is the CSS
// rule of the same name, so adding a kind means touching both — deliberately:
// a family without a colour reads as "unknown file", which is a lie.
const KIND_ICONS = {
  image: ImageIcon,
  video: Film,
  audio: Music2,
  pdf: FileType,
  sheet: FileSpreadsheet,
  doc: FileText,
  slides: Presentation,
  text: FileText,
  code: FileCode2,
  archive: Archive,
  file: FileText,
};

// Even numbers, for the same reason `Button.ICON_SIZES` is even: the squares
// are 28, 36 and 56 pixels and the glyph is flex-centred in them, so an odd
// size puts it on a half-pixel and the browser picks a side — a different one
// at every zoom level.
const GLYPH_SIZES = { sm: 14, md: 16, lg: 22 };
const PLAY_BADGE_SIZES = { sm: 10, md: 12, lg: 18 };

/**
 * One file, as a square: its own picture where it has one, its family's glyph
 * where it does not.
 *
 * @param {object} props.attachment The stored file record, or a picked `File`.
 * @param {string} props.previewUrl Overrides where the picture comes from — a blob URL for a file that is not uploaded yet, or a signed URL for a private one.
 * @param {'sm'|'md'|'lg'} props.density How big the square is. `md` is the list square; `sm` rides inside a chat tile.
 * @param {boolean} props.dark The square sits on a dark surface, so the tint borrows the surface's light instead of the hue's.
 * @param {string} props.className Placement in the parent only.
 */
export default function FileThumb({
  attachment,
  previewUrl,
  density = 'md',
  dark = false,
  className = '',
}) {
  const kind = attachmentKind(attachment);
  const url = previewUrl || attachmentUrl(attachment);
  const Icon = KIND_ICONS[kind] || FileText;
  const showsPicture = isVisualKind(kind) && Boolean(url);

  return (
    <span
      className={`ui-file-glyph ${className}`}
      data-ui-file-kind={kind}
      data-ui-density={density}
      data-ui-tone={dark ? 'dark' : undefined}
      aria-hidden="true"
    >
      {showsPicture ? (
        <span className="relative block h-full w-full">
          {kind === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            // A video knows what it looks like; asking for the metadata alone is
            // enough for the browser to paint its first frame, and `#t=0.1`
            // steps past the black leader frame most encoders write.
            <video
              src={`${url}#t=0.1`}
              preload="metadata"
              muted
              playsInline
              tabIndex={-1}
              className="h-full w-full object-cover"
            />
          )}
          {kind === 'video' && (
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
              <Play size={PLAY_BADGE_SIZES[density] || PLAY_BADGE_SIZES.md} fill="currentColor" className="ml-[1px]" />
            </span>
          )}
        </span>
      ) : (
        <Icon size={GLYPH_SIZES[density] || GLYPH_SIZES.md} />
      )}
    </span>
  );
}
