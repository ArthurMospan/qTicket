'use client';
import React from 'react';

// ─── UI Kit: Segmented Control ───────────────────────────────────────────────
// Compact pill switch for mutually exclusive view options (period, week/month…).
// Designed to sit INSIDE a FilterBar (transparent bg, active pill = white),
// so per-tab view controls live in the same container as the other filters.
//
// <Segmented value={period} onChange={setPeriod}
//   options={[7, 14, 30, 90].map(d => ({ value: d, label: `${d}д` }))} />

const SURFACES = {
  transparent: '',
  canvas: 'bg-canvas',
};

/**
 * Compact pill switch for mutually exclusive view options (period, week/month).
 * Drawn to sit inside a `FilterBar`, so a per-tab view control lives in the
 * same container as the filters instead of floating beside it.
 *
 * @param {string|number} props.value Selected option value.
 * @param {(value) => void} props.onChange Fires with the newly selected value.
 * @param {{value: string|number, label: string}[]} props.options The choices, in the order they are drawn.
 * @param {'transparent'|'canvas'} props.surface Background: transparent inside a filter bar, canvas when standing alone.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {string} props.className Placement in the parent only.
 */
export default function Segmented({
  value,
  onChange,
  options = [],
  surface = 'transparent',
  composition,
  className = '',
}) {
  return (
    <div
      role="group"
      aria-label="Вибір режиму"
      data-ui-composition={composition}
      className={`ui-segmented flex items-center gap-[2px] p-[2px] rounded-[8px] shrink-0 ${SURFACES[surface] ?? ''} ${className}`}
    >
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange?.(o.value)}
          aria-pressed={value === o.value}
          className={`px-[10px] h-[26px] text-[12px] font-semibold rounded-[7px] transition-all cursor-pointer ${
            value === o.value
              ? 'bg-white text-ink shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
