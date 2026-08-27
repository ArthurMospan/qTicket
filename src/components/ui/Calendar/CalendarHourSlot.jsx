'use client';

// ─── UI Kit: Calendar Hour Slot ──────────────────────────────────────────────
// One hour of a day column in the week grid. It draws almost nothing — a rule
// along its top and the faintest tint under the pointer — because its job is to
// be a target, not an object: clicking it creates an event at that hour.

import React from 'react';

/**
 * One hour of a day column, as a create-here target.
 *
 * Its position and height are measured from the grid, so they arrive as inline
 * style; there is no class that can express "top: 9 hours".
 *
 * @param {string} props.label Accessible name, since the slot has no text of its own.
 * @param {React.CSSProperties} props.style Placement within the day column.
 * @param {(event) => void} props.onClick Creates an event at this hour.
 * @param {string} props.className Placement in the parent only.
 */
export default function CalendarHourSlot({ label, style, onClick, className = '', ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      style={style}
      onClick={onClick}
      className={`absolute left-0 right-0 border-t border-line transition-colors hover:bg-black/[0.015] ${className}`}
      {...props}
    />
  );
}
