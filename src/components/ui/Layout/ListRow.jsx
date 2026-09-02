'use client';

// ─── UI Kit: List Row ────────────────────────────────────────────────────────
// A row in a divided list: no border, no radius, no fill at rest. The list
// draws the dividers; the row draws only what happens under the pointer.
//
// It existed twice — search results and the workload table — with the same
// shape and two different hovers (`bg-canvas` against `bg-canvas/70`), which is
// the kind of difference nobody chooses and nobody can see side by side. One
// hover now.
//
// And that one hover was `bg-canvas`, which is the bug this comment replaces.
// Every list of these in the product is a white `Card` inside a `Surface
// preset="panel"` — and a panel *is* `canvas`. So pointing at a row painted it
// the exact colour of the panel sixteen pixels away: the row did not highlight,
// it dissolved, and the list grew a hole where the pointer was. `canvas` is the
// right hover for a row sitting on white and there is no such row here.
//
// `line` is the kit's existing next step down — `Button` rests on `canvas` and
// hovers to `line`, and so does `LoadOlderButton`. It reads against white and
// against a panel both, which is what a row that does not know its own ground
// needs. Deliberately not a variant: both call sites are the same case, and a
// knob nobody sets is a way for the next list to get this wrong again.
//
// Layout stays at the call site: one of these is a flex row with a chevron at
// the end, the other a six-column grid. What the kit owns is that a row in a
// list is a real button with one density scale and one hover.

import React from 'react';

const DENSITIES = {
  compact: 'px-4 py-2.5',
  roomy: 'px-4 py-4 sm:px-5',
  // The feed's own height, so a list of records and a list of events sitting in
  // two panels of one screen line up. See `soft` below.
  feed: 'px-[10px] py-[7px]',
};

// Two lists, and the product genuinely has both.
//
// `divided` is a run of rows inside one white card, separated by hairlines and
// with nothing but a hover under the pointer: a search result, a support
// channel — things read as one block, where the block is the object and the row
// is a line of it.
//
// `card` is the row as its own tile: white ground, hairline edge, 12px radius,
// a ring under the pointer, stacked with a gap. It is not a new shape — it is
// exactly what `TaskRow` and `ActivityRow` already draw, which is to say it is
// the shape this product uses whenever the *row* is the object. Two screens
// were drawing lists of that second kind in the first kind's clothes: a
// project's «Учасники» and «Проєкти» on «Огляд», where each row stands for a
// whole thing you open and none of them belong to a single block. Corners went
// round only at the top and bottom of the run, one hover swept a continuous
// slab, and nobody could say why those lists looked unlike every other list in
// the product. They looked unlike it because they were.
const SHAPES = {
  divided: '',
  card: 'rounded-[12px] border border-line bg-white',
  // The third one, and it is the quietest: a grey tile on a white panel, no
  // edge of its own, filling one step darker under the pointer. It is what the
  // project card's activity has always drawn and what `ActivityRow` draws now,
  // and «Проєкти» on «Огляд» sits in the panel next to that feed — so a list of
  // projects and a list of events had to stop being a bordered white tile
  // beside a grey one. `card` stays for the lists that stand alone on a panel
  // of their own, where the edge is the only thing separating a row from it.
  soft: 'rounded-[10px] bg-canvas',
};

/**
 * One row of a divided list. A button where it opens something, a plain row
 * where it does not.
 *
 * Not every list of these leads anywhere: a customer reads the desk's roster
 * and opens nobody, because a support profile carries the other customers that
 * person works with. Those lists used to drop out of the component and
 * hand-write `px-4 py-4 sm:px-5` on a `div` to match this file's `roomy` — one
 * list, two implementations, and the copy would keep the old numbers the day
 * the density changed here. Passing no `onClick` is the whole of it: no
 * button, no hover, no tab stop, the same geometry.
 *
 * @param {'compact'|'roomy'|'feed'} props.density Row height: a search result, a table row, or a line of a feed.
 * @param {'divided'|'card'|'soft'} props.shape A line of one block, a tile of its own, or a quiet grey tile on a white panel. See above.
 * @param {React.ReactNode} props.children The row's own layout — flex, grid, whatever it needs.
 * @param {(event) => void} props.onClick Opens whatever the row stands for. Without it the row is inert.
 * @param {string} props.className Placement and layout in the parent only.
 */
export default function ListRow({
  density = 'compact',
  shape = 'divided',
  children,
  onClick,
  className = '',
  ...props
}) {
  const surface = SHAPES[shape] ?? SHAPES.divided;
  const geometry = `w-full text-left ${surface} ${DENSITIES[density] ?? DENSITIES.compact} ${className}`;
  if (!onClick) {
    return (
      <div className={geometry} {...props}>
        {children}
      </div>
    );
  }
  // A tile lights up with a ring, a line of a block with a fill — the same
  // difference `TaskRow` and `SearchModal` already draw, for the same reason:
  // a fill on a tile fights its own edge, and a ring around a line of a card
  // is a rectangle drawn inside another rectangle.
  const hover = shape === 'card'
    ? 'transition-all duration-200 hover:!ring-4 hover:!ring-line'
    : 'transition-colors hover:bg-line';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${geometry} ${hover}`}
      {...props}
    >
      {children}
    </button>
  );
}
