'use client';

// ─── UI Kit: Attachment Row ──────────────────────────────────────────────────
// One attachment on a task, as a list row: what the file is, its name and size,
// and the actions that apply to it.
//
// Four hand-written controls in one row — thumbnail, name, download, delete —
// which is why this was the densest patch of native markup on the task surface.
// It lived in IssueDetail, so /ui-kit had no way to draw an attachment and no
// way to notice the row drifting from the card beside it.
//
// Two things it no longer decides for itself. What a file *looks* like is
// `FileThumb` — the same square the chat draws, so a .xlsx is a green sheet in
// both and not a grey page in both. And a sound file is not a thing you open in
// a black full-screen lightbox to hear: the row plays it where it lies, with
// the same `AudioPlayer` the chat and the client portal use.
//
// Downloading is a callback rather than an import so the kit stays clear of the
// portal's transfer code: the row decides how the control looks, the page
// decides what the click does.

import React from 'react';
import { Download, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import IconAction from '@/components/ui/IconAction';
import AudioPlayer from '@/components/ui/Attachments/AudioPlayer';
import FileThumb from '@/components/ui/Attachments/FileThumb';
import {
  attachmentKind,
  attachmentMetaLabel,
  attachmentUrl,
} from '@/lib/utils/attachmentKinds.mjs';

/**
 * One file on a task: what kind it is, its name and size, and the actions
 * available for it. What the actions are depends on where the row is — editing
 * a description offers "insert", an archived task offers only download.
 *
 * @param {object} props.attachment The stored file record.
 * @param {boolean} props.isEditing The description is open for editing, so inserting a link is possible.
 * @param {boolean} props.isArchived Read-only history: nothing may be deleted.
 * @param {(attachment) => void} props.onOpen Opens the file in the viewer.
 * @param {(attachment, kind, url) => void} props.onInsert Inserts a markdown link to it into the description.
 * @param {(attachmentId: string) => void} props.onDelete Removes it from the task.
 * @param {(url: string, name: string) => void} props.onDownload Downloads it.
 */
export default function AttachmentRow({
  attachment,
  isEditing = false,
  isArchived = false,
  onOpen,
  onInsert,
  onDelete,
  onDownload,
}) {
  const url = attachmentUrl(attachment);
  const kind = attachmentKind(attachment);
  const meta = attachmentMetaLabel(attachment, kind);

  const actions = (
    <>
      {isEditing && url && (
        <Button style="ghost" size="sm" onClick={() => onInsert(attachment, kind, url)}>
          Вставити в опис
        </Button>
      )}
      {url && (
        <IconAction
          icon={Download}
          size="sm"
          appearance="quiet"
          label={`Завантажити ${attachment.name}`}
          title="Завантажити"
          onClick={() => onDownload(url, attachment.name)}
        />
      )}
      {!isArchived && (
        <IconAction
          icon={Trash2}
          size="sm"
          appearance="quiet-danger"
          label={`Видалити ${attachment.name}`}
          title="Видалити"
          onClick={() => onDelete(attachment.id)}
        />
      )}
    </>
  );

  return (
    // Same answer to the cursor as the subtask rows a few centimetres below —
    // a hairline border and the pale halo. Hovering used to turn the row grey,
    // which on a grey panel made it disappear into the background instead of
    // lifting off it.
    <div
      data-ui-surface="nested-card"
      data-ui-padding="compact-row"
      // Обводка, і тільки обводка. Це той самий рядок, що й вкладення та
      // звʼязки поруч на одному екрані: якби сусіди перестали сіріти, а цей
      // лишився, екран сперечався б сам із собою.
      className="ui-surface flex min-w-0 items-center gap-3 border border-line transition-all duration-200 hover:ring-4 hover:ring-line"
    >
      {kind === 'audio' ? (
        // The row *is* the player. Nothing here opens a viewer: the file is
        // already doing the only thing anybody wanted from it.
        <AudioPlayer
          className="flex-1"
          src={url}
          title={attachment.name}
          meta={meta}
          actions={actions}
        />
      ) : (
        <>
          {/* Thumbnail, text, and the whitespace between them are one target. The
              old split target underlined only the filename, so a large row looked
              clickable in one tiny place even though the preview action was the
              same everywhere. */}
          <button
            type="button"
            onClick={() => onOpen(attachment)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-[8px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            aria-label={`Переглянути ${attachment.name}`}
          >
            <FileThumb attachment={attachment} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-ink">{attachment.name}</span>
              <span className="block text-[10px] text-faint">{meta}</span>
            </span>
          </button>
          {actions}
        </>
      )}
    </div>
  );
}
