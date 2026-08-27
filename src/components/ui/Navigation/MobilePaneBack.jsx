'use client';

import React from 'react';
import { ArrowLeft } from 'lucide-react';

// Which kind of "back" this is, and therefore whether a desk needs it.
//
// `pane` is the original one: `SidebarLayout` shows one pane at a time below
// md, so the visible pane has to offer a way out — and at md and up both panes
// are on screen, where an arrow saying "back to the list" points at something
// already visible. It hides itself there.
//
// `level` is a step inside one screen, and a screen has the same steps at every
// width: «Інтеграції» → одна інтеграція, «Перенесення даних» → одне джерело.
// Those used to be a labelled ghost button above the title on a desk and this
// arrow beside it on a phone — one control, drawn two ways, in two places. It is
// the arrow now at both widths, with the destination still spoken by its
// accessible name.
const CONTEXTS = {
  pane: 'md:hidden',
  level: '',
};

/**
 * The way back, as an arrow beside the title. `context` decides whether it is
 * the way out of a pane — which only a phone has — or a step inside a screen,
 * which every width has.
 *
 * It used to be a labelled text button on a line of its own («Всі
 * налаштування»), which cost a row of screen and, worse, stacked: a settings
 * section with its own way back — «Усі інтеграції» — put two of them one above
 * the other, each returning somewhere different. An arrow beside the title is
 * one control in the one place a phone looks for it, so there is only ever room
 * for one and it always means "one level up".
 *
 * Chat had already arrived at exactly this arrow and drew its own, with a note
 * saying it should become shared the moment Settings and Team adopted it. They
 * have; this is it. A 26px box — an 18px glyph with 4px around it — which is
 * deliberately not on the `IconAction` scale: this control sits in a title row
 * and has to align with type, not with a toolbar.
 *
 * The words are still here, as the accessible name and the tooltip. «До списку
 * команди» is what the arrow does; it just no longer takes a line to say so.
 *
 * @param {string} props.label Where it goes back to, in words. Read by screen readers, shown as the tooltip.
 * @param {'pane'|'level'} props.context Out of a single pane (phone only), or one step up inside a screen (every width).
 * @param {() => void} props.onClick Goes there.
 * @param {string} props.className Placement in the parent only.
 */
export default function MobilePaneBack({ label, context = 'pane', onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`${CONTEXTS[context] ?? CONTEXTS.pane} -ml-1 shrink-0 p-1 text-muted transition-colors hover:text-ink ${className}`}
    >
      <ArrowLeft size={18} />
    </button>
  );
}
