'use client';

// ─── UI Kit: Bar List ────────────────────────────────────────────────────────
// "How much of each" — statuses, types, priorities, projects, people.
//
// There were five hand-written versions of this chart across four files, and no
// two agreed. Two put the label above the bar and three squeezed it into a
// fixed 90–110px column where every name was truncated; the bars were 5px, 6px
// and 8px tall; the tracks were #f0f0f0, bg-canvas and bg-white; one scaled to
// the largest value, one to the total, and one multiplied its percentage by
// three to "make small bars visible", which is simply a chart that lies.
//
// One chart. It scales to the largest value, because that is what "compare
// these to each other" means; pass `scale="total"` where the bars really are
// shares of one whole. The bar carries the colour, never the text — a label
// tinted with its own series hue is unreadable at the light end of any ramp and
// says nothing the mark beside it has not already said.

import React from 'react';

const TRACK = 'var(--color-chart-track)';
const DEFAULT_FILL = 'var(--color-chart-1)';

/**
 * A list of named quantities, as bars.
 *
 * @param {{id: string, label: string, value: number, color?: string, leading?: React.ReactNode, meta?: string}[]} props.items What to draw. `color` is for entities that own one — a status, a type — never for encoding size. `leading` replaces the colour dot where the entity has a glyph of its own, which is also what keeps identity from resting on colour alone.
 * @param {'max'|'total'} props.scale What a full bar means: the largest value here, or the sum of them.
 * @param {(value: number) => string} props.format How to print a value. Defaults to the number itself.
 * @param {string} props.emptyText Shown instead of an empty list.
 * @param {string} props.className Placement in the parent only.
 */
export default function BarList({
  items = [],
  scale = 'max',
  format,
  emptyText = 'Немає даних',
  className = '',
}) {
  if (items.length === 0) {
    return <p className={`py-6 text-center text-[12px] text-faint ${className}`}>{emptyText}</p>;
  }

  const total = items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const max = Math.max(...items.map(item => Number(item.value) || 0), 1);
  const basis = scale === 'total' ? Math.max(total, 1) : max;
  const print = format || (value => String(value));

  return (
    <div className={`flex flex-col gap-[14px] ${className}`}>
      {items.map(item => {
        const value = Number(item.value) || 0;
        const share = Math.max(0, Math.min(1, value / basis));
        return (
          <div key={item.id} className="flex min-w-0 flex-col gap-[6px]">
            {/* The label sits above the bar and gets the full width. In a fixed
                side column every status name in the product was truncated. */}
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                {item.leading || (item.color && (
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
                ))}
                <span className="truncate text-[13px] font-semibold text-ink">{item.label}</span>
                {item.meta && <span className="shrink-0 text-[11px] text-muted">{item.meta}</span>}
              </span>
              <span className="ui-type-figure shrink-0 text-ink">{print(value)}</span>
            </div>
            <div className="h-[6px] overflow-hidden rounded-full" style={{ background: TRACK }}>
              <div
                className="h-full rounded-full transition-[width] duration-300"
                style={{ width: `${share * 100}%`, background: item.color || DEFAULT_FILL }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
