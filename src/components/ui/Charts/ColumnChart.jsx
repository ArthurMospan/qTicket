'use client';

// ─── UI Kit: Column Chart ────────────────────────────────────────────────────
// A quantity over time — opened and closed per day, per week.
//
// The version this replaces stacked its two series in one column, which is the
// wrong shape for the question: nobody wants "opened plus closed", they want to
// see one against the other. It also drew each bar at the full width of its
// slot with a 4px gap, so thirty days ran together into a grey field, and it
// gave the context series 60% opacity — a fifth colour nobody chose.
//
// Two series at most. Beyond that this is the wrong chart: fold the tail or
// facet. The columns are capped rather than filling their band, so the leftover
// is air; hovering one lights the whole band, not the 6px mark inside it.

import React, { useState } from 'react';

const MAX_COLUMN = 18;

/**
 * Columns over time, with one or two series.
 *
 * @param {{label: string, values: number[]}[]} props.data One entry per time slot; `values` is one number per series, in series order.
 * @param {{label: string, color: string}[]} props.series What each value means. Two at most — the second is drawn as context behind the first.
 * @param {number} props.height Plot height in pixels, excluding the axis band below it.
 * @param {(value: number) => string} props.format How a value reads in the tooltip.
 * @param {string} props.className Placement in the parent only.
 */
export default function ColumnChart({
  data = [],
  series = [],
  height = 120,
  format,
  className = '',
}) {
  const [hovered, setHovered] = useState(null);
  const print = format || (value => String(value));
  const max = Math.max(
    ...data.flatMap(point => point.values.map(value => Number(value) || 0)),
    1,
  );

  if (data.length === 0) {
    return <p className={`py-6 text-center text-[12px] text-faint ${className}`}>Немає даних за період</p>;
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="relative">
        {/* A single hairline baseline. There is no gridline field: the values
            live in the tooltip and the axis, and a ruled background behind
            thirty thin columns is more ink than the data. */}
        <div
          className="absolute inset-x-0 bottom-0 h-px"
          style={{ background: 'var(--color-chart-grid)' }}
          aria-hidden="true"
        />
        <div className="flex items-end gap-[3px]" style={{ height }}>
          {data.map((point, index) => (
            <div
              key={`${point.label}-${index}`}
              // The hit target is the whole band including the gap, so a day
              // with a value of one is as easy to hover as a day with fifty.
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(current => (current === index ? null : current))}
              className={`relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-[4px] transition-colors ${
                hovered === index ? 'bg-canvas' : ''
              }`}
            >
              <div className="flex h-full w-full items-end justify-center gap-[2px]">
                {point.values.map((rawValue, seriesIndex) => {
                  const value = Number(rawValue) || 0;
                  return (
                    <span
                      key={seriesIndex}
                      className="w-full rounded-t-[4px] transition-[height] duration-300"
                      style={{
                        maxWidth: MAX_COLUMN,
                        height: `${(value / max) * 100}%`,
                        minHeight: value > 0 ? 3 : 0,
                        background: series[seriesIndex]?.color || 'var(--color-chart-1)',
                      }}
                    />
                  );
                })}
              </div>
              {hovered === index && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-ink px-2 py-1.5 text-[10px] font-semibold text-white shadow-lg"
                >
                  <span className="block text-white/60">{point.label}</span>
                  {point.values.map((value, seriesIndex) => (
                    <span key={seriesIndex} className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: series[seriesIndex]?.color || 'var(--color-chart-1)' }}
                      />
                      {series[seriesIndex]?.label}: {print(Number(value) || 0)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-faint">{data[0]?.label}</span>
        <span className="text-[10px] text-faint">{data[data.length - 1]?.label}</span>
      </div>

      {/* A legend is present whenever there are two series — identity is never
          left to colour-matching alone. One series needs none: the card title
          already says what is plotted. */}
      {series.length > 1 && (
        <div className="flex flex-wrap items-center gap-4">
          {series.map(item => (
            <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
