'use client';

import React from 'react';

// ─── UI Kit: Distribution Bar ────────────────────────────────────────────────
// How a set of things splits between named buckets: a label, a proportional
// bar, a count.
//
// Not a chart library and deliberately not one. The question these answer —
// «скільки з них у якому статусі» — is a list of five to eight rows, and every
// axis, tooltip and legend a chart would add is furniture around a number the
// row already prints. The one thing it does insist on is a shared scale: each
// bar is a fraction of the largest bucket, so two rows of the same length hold
// the same count and the eye can be trusted.
//
// Colour is data here rather than styling: a status, a type and a priority all
// carry their own colour out of the workflow document, and that colour is the
// one the board and the badges already use. A row with none falls back to the
// chart's own measure token, so a bucket that never had a colour is not a hole.

/**
 * One measure, split across named buckets, as a list of proportional bars.
 *
 * @param {{id: string, label: string, value: number, color?: string}[]} props.items The buckets, in the order they should read.
 * @param {string} props.emptyLabel What to say when every bucket is zero.
 * @param {string} props.className Placement in the parent only.
 */
export default function DistributionBar({ items = [], emptyLabel = 'Немає даних', className = '' }) {
  const rows = (items || []).filter(item => item && item.label);
  const total = rows.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const largest = rows.reduce((max, item) => Math.max(max, Number(item.value) || 0), 0);

  if (!rows.length || total === 0) {
    return <p className={`py-2 text-[12px] text-faint ${className}`}>{emptyLabel}</p>;
  }

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {rows.map(item => {
        const value = Number(item.value) || 0;
        // Against the largest bucket, not against the total: a set split
        // 60/20/20 draws one full bar and two thirds, which reads. Against the
        // total, the same set draws three short stubs against a lot of empty
        // track and says only «none of these is most of it».
        const width = largest > 0 ? Math.max(value > 0 ? 2 : 0, (value / largest) * 100) : 0;
        return (
          <div key={item.id || item.label} className="flex items-center gap-3">
            <span className="w-[112px] shrink-0 truncate text-[12px] text-muted" title={item.label}>
              {item.label}
            </span>
            <span className="h-[8px] min-w-0 flex-1 overflow-hidden rounded-full bg-chart-track">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${width}%`,
                  // Data colour: the status, type or priority's own, straight
                  // out of the workflow document.
                  backgroundColor: item.color || 'var(--color-chart-1)',
                }}
              />
            </span>
            <span className="w-[36px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-ink">
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
