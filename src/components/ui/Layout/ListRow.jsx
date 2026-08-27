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
// Layout stays at the call site: one of these is a flex row with a chevron at
// the end, the other a six-column grid. What the kit owns is that a row in a
// list is a real button with one density scale and one hover.

import React from 'react';

const DENSITIES = {
  compact: 'px-4 py-2.5',
  roomy: 'px-4 py-4 sm:px-5',
};

/**
 * One row of a divided list, as a real button.
 *
 * @param {'compact'|'roomy'} props.density Row height: a search result against a table row.
 * @param {React.ReactNode} props.children The row's own layout — flex, grid, whatever it needs.
 * @param {(event) => void} props.onClick Opens whatever the row stands for.
 * @param {string} props.className Placement and layout in the parent only.
 */
export default function ListRow({ density = 'compact', children, onClick, className = '', ...props }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left transition-colors hover:bg-canvas ${DENSITIES[density] ?? DENSITIES.compact} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
