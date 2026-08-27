'use client';

// ─── UI Kit: Meter ───────────────────────────────────────────────────────────
// One ratio against a limit: hours burnt against a budget, subtasks finished
// against subtasks opened.
//
// The budget bar this replaces changed hue with severity — ink under 70%, then
// yellow-400, then red-500 — while the subtask bar next to it was emerald at
// every value and the workload bar mixed its own #7ba98d and #c96a5a. Three
// bars, three unrelated palettes, one question.
//
// Severity is a real thing to say, so it stays: but it is said with the status
// scale the rest of the product uses and a word beside the number, because a
// bar that is only red says "bad" to everyone except the readers who cannot see
// that it is red.

import React from 'react';

// Where the reading sits. A card gives a meter a block of its own, so the
// figure goes on its own line above the bar. A table row is one line — and a
// meter that stacked inside a 36px cell filled 34 of them, put its figure on a
// baseline nothing else in the row shared, and left the bar hard against the
// hairline below. Same meter, laid along the row instead of across it.
const LAYOUTS = {
  stack: 'flex-col gap-2',
  inline: 'flex-row items-center gap-3',
};

// Three tones, not four. A `good` step was declared and never reached: a meter
// that is fine says so by being neutral, and colouring "nothing is wrong" green
// spends the reader's attention on the one thing that did not need it.
const TONES = {
  // Ordinary progress. Nothing is wrong, so nothing is coloured as though it is.
  neutral: { fill: 'var(--color-chart-1)', text: 'text-ink' },
  warning: { fill: 'var(--color-warning)', text: 'text-warning' },
  danger: { fill: '#ef4444', text: 'text-danger' },
};

/**
 * A share of a whole, drawn as one bar.
 *
 * @param {number} props.value How much of the limit is used, 0–1. Values above 1 fill the bar and are still reported in the label.
 * @param {'neutral'|'warning'|'danger'} props.tone What the level means. `neutral` is the default because most progress means nothing beyond itself.
 * @param {string} props.label What is being measured, above the bar.
 * @param {React.ReactNode} props.reading The figure, printed opposite the label.
 * @param {'stack'|'inline'} props.layout Reading above the bar, or beside it. `inline` is for a table cell, where the row is one line.
 * @param {number} props.height Bar thickness in pixels.
 * @param {string} props.className Placement in the parent only.
 */
export default function Meter({
  value = 0,
  tone = 'neutral',
  label,
  reading,
  layout = 'stack',
  height = 8,
  className = '',
}) {
  const level = TONES[tone] || TONES.neutral;
  const share = Math.max(0, Math.min(1, Number(value) || 0));
  const inline = layout === 'inline';

  const track = (
    <div
      className={`overflow-hidden rounded-full ${inline ? 'min-w-0 flex-1' : 'w-full'}`}
      style={{ height, background: 'var(--color-chart-track)' }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${share * 100}%`, background: level.fill }}
      />
    </div>
  );

  if (inline) {
    return (
      <div className={`flex min-w-0 ${LAYOUTS.inline} ${className}`}>
        {label && <span className="shrink-0 truncate text-[12px] font-semibold text-ink">{label}</span>}
        {track}
        {/* An inline meter is in a row of figures by definition, so its reading
            takes the same step back the rest of that row takes — otherwise the
            one figure that came with its own bar is also the loudest. */}
        {reading && (
          <span data-ui-density="column" className={`ui-type-figure shrink-0 ${level.text}`}>{reading}</span>
        )}
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 ${LAYOUTS.stack} ${className}`}>
      {(label || reading) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && <span className="truncate text-[12px] font-semibold text-ink">{label}</span>}
          {/* `ml-auto`, not `justify-between` alone. A meter that measures
              something the caption above the column already names carries a
              reading and no label — and a lone child of a `justify-between` row
              sits at its *start*, so the one figure on the line was hugging the
              left edge of a bar it belongs to the end of. */}
          {reading && <span className={`ui-type-figure ml-auto shrink-0 ${level.text}`}>{reading}</span>}
        </div>
      )}
      {track}
    </div>
  );
}
