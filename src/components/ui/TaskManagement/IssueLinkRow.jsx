'use client';

// ─── UI Kit: Issue Link Row ──────────────────────────────────────────────────
// One relation between two tasks: the relation's name, the task it points at,
// and the unlink action that fades in on hover.
//
// The row is where the "requires review" flag surfaces — the marker on legacy
// `subtask-of` links whose direction cannot be recovered — and that state had
// no representation anywhere the kit could show it.
//
// Kept exactly as it shipped, unlink button included. That button is a bare
// `<button>` rather than a `TextAction` on purpose: `TextAction` is `inline-flex`,
// and this one is `inline-block` around a lone 13px glyph, so the svg still sits
// on the text baseline and the box is a couple of pixels taller than the icon.
// Swapping it would silently resize the hit area, so the row owns the markup and
// the geometry travels with it.
//
// The one thing that did change: the answer to the cursor. Relations sat two
// centimetres under the subtasks and the attachments and answered a hover with
// `bg-[#eeeeee]` — going *darker* on a panel that is already grey, so the row
// sank into the background while its neighbours lifted off it. It now draws the
// same nested card those two draw, and lifts the same way.

import React from 'react';
import { Trash2 } from 'lucide-react';
import Pill from '@/components/ui/DataDisplay/Pill';

/**
 * One relation between two tasks — «блокує», «дублює» — with the linked task
 * beside it. The row owns its geometry because the hit area of the remove
 * button is part of it.
 *
 * @param {string} props.label The relation type, printed as the leading badge.
 * @param {boolean} props.requiresReview The link came from an import and nobody has confirmed it yet.
 * @param {boolean} props.canRemove Whether the reader may break this link.
 * @param {() => void} props.onRemove Breaks it.
 * @param {React.ReactNode} props.children The linked task.
 */
export default function IssueLinkRow({
  label,
  requiresReview = false,
  canRemove = true,
  onRemove,
  children,
}) {
  return (
    <div
      data-ui-surface="nested-card"
      data-ui-padding="row"
      // Обводка, і тільки обводка — так само, як у рядку завдання. Заливка
      // була #fcfcfc і стала `bg-canvas` під час переїзду на токени; це три
      // одиниці від білого проти одинадцяти, тож рядок почав сірішати цілком і
      // топити в собі кільце, яке й є нашим ховером.
      className="ui-surface group flex items-center justify-between gap-3 border border-line transition-all duration-200 hover:ring-4 hover:ring-line"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Pill tone="neutral" size="sm" shape="badge" uppercase>
          {label}
        </Pill>
        {requiresReview && (
          <Pill
            tone="warning"
            size="sm"
            shape="badge"
            title="Старий зв’язок «підзавдання»: напрямок не можна відновити автоматично"
          >
            Потребує перевірки
          </Pill>
        )}
        {children}
      </div>
      {canRemove && (
        <button
          onClick={onRemove}
          className="text-faint hover:text-danger transition-colors opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-danger-soft"
          title="Видалити зв'язок"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
