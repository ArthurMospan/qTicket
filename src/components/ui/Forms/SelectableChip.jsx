'use client';

// ─── UI Kit: Selectable Chip ─────────────────────────────────────────────────
// A chip you press to include something: an assignee on a new task, a label on
// a new task. It is a toggle, not a link — `aria-pressed` carries the state, so
// the selected look is a state of one control rather than two controls.
//
// The two shapes come straight out of the two call sites and differ by what
// they hold: `person` is a 12px row with a face and a tick, `label` is an 11px
// row with a tag glyph and the label's own colour. Neither is a size in the
// generic scale, which is exactly why they were retyped by hand — the kit had
// no chip that could be pressed.
//
// The `tone` prop covers the label case: a colour with a `14` alpha suffix for
// the fill and the same colour for the text, which no utility class can express
// because the value comes from the database at render time.

import React from 'react';

const SHAPES = {
  person: 'flex items-center gap-2 px-3 py-[6px] rounded-[8px] text-[12px] font-medium border transition-all',
  label: 'inline-flex items-center gap-1.5 rounded-[8px] px-[10px] py-[3px] text-[11px] font-medium transition-colors',
};

const STATES = {
  person: {
    on: 'bg-ink text-white border-ink',
    off: 'bg-white text-ink border-line hover:border-muted',
  },
  label: {
    on: '',
    off: 'bg-ink/5 text-ink hover:bg-ink/10',
  },
};

/**
 * A chip you can switch on and off — picking assignees, filtering by label. It
 * reports its state as `aria-pressed`, so it is a toggle button and not a
 * checkbox wearing a chip's clothes.
 *
 * @param {React.ReactNode} props.children Chip content.
 * @param {'person'|'label'} props.shape Which of the two chip geometries to draw.
 * @param {boolean} props.selected Whether it is switched on.
 * @param {boolean} props.disabled Offered, but not to you — the composer draws
 *   a colleague who is not on the selected project this way rather than hiding
 *   them, so the reason can be said instead of the name simply being absent.
 * @param {string} props.tone Optional colour role for the `label` shape.
 * @param {string} props.className Placement in the parent only.
 */
export default function SelectableChip({
  children,
  shape = 'person',
  selected = false,
  disabled = false,
  tone,
  className = '',
  ...props
}) {
  const shapeClass = SHAPES[shape] ?? SHAPES.person;
  const stateClass = (STATES[shape] ?? STATES.person)[selected ? 'on' : 'off'];
  const disabledClass = disabled ? 'opacity-45 cursor-not-allowed hover:border-line' : '';

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={`${shapeClass} ${stateClass} ${disabledClass} ${className}`.trim()}
      style={selected && tone ? { background: `${tone}14`, color: tone } : undefined}
      {...props}
    >
      {children}
    </button>
  );
}
