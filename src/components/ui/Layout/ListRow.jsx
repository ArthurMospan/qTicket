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
 * @param {'compact'|'roomy'} props.density Row height: a search result against a table row.
 * @param {React.ReactNode} props.children The row's own layout — flex, grid, whatever it needs.
 * @param {(event) => void} props.onClick Opens whatever the row stands for. Without it the row is inert.
 * @param {string} props.className Placement and layout in the parent only.
 */
export default function ListRow({ density = 'compact', children, onClick, className = '', ...props }) {
  const geometry = `w-full text-left ${DENSITIES[density] ?? DENSITIES.compact} ${className}`;
  if (!onClick) {
    return (
      <div className={geometry} {...props}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${geometry} transition-colors hover:bg-line`}
      {...props}
    >
      {children}
    </button>
  );
}
