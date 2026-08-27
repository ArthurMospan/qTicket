'use client';

// ─── UI Kit: Sparkline ───────────────────────────────────────────────────────
// The shape of a number's recent history, at the size of a word.
//
// A stat tile that says "18 closed" and a stat tile that says "18 closed, and
// it was 3 last week" are different facts, and analytics only ever showed the
// first. The trend arrow beside the figure said the direction; this says the
// shape, which is the part that tells you whether the number is a spike or a
// level.
//
// No axis, no labels, no tooltip: it is a glyph, not a chart. The figure above
// it carries the value, and the chart the tile links to carries the detail.

import React from 'react';

/**
 * A bare line over the last N values.
 *
 * @param {number[]} props.values Oldest first. Fewer than two draws nothing.
 * @param {number} props.width Drawing width in pixels.
 * @param {number} props.height Drawing height in pixels.
 * @param {string} props.className Placement in the parent only.
 */
export default function Sparkline({ values = [], width = 68, height = 22, className = '' }) {
  if (values.length < 2) return null;

  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  const stroke = 1.5;
  const x = index => (index / (values.length - 1)) * (width - stroke) + stroke / 2;
  const y = value => height - stroke / 2 - ((value - min) / span) * (height - stroke);
  const points = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <polygon
        points={`${points} ${x(values.length - 1)},${height} ${x(0)},${height}`}
        fill="var(--color-chart-1)"
        fillOpacity="0.1"
      />
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-chart-1)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The end dot says which side is now. It carries the surface ring every
          marker in the kit carries, so it stays legible over the line. */}
      <circle
        cx={x(values.length - 1)}
        cy={y(values[values.length - 1])}
        r="2.5"
        fill="var(--color-chart-1)"
        stroke="#ffffff"
        strokeWidth="1.5"
      />
    </svg>
  );
}
