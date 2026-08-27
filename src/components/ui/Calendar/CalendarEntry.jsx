'use client';

// ─── UI Kit: Calendar Entry ──────────────────────────────────────────────────
// One entry inside a day cell — an event or a deadline.
//
// The calendar is its own structure, the way chat is: a day cell is not a list
// row, so this is not `Card` or `Pill` bent into shape. It is the first of the
// three the grid is made of, beside `CalendarDayNumber` and `CalendarHourSlot`.

import React from 'react';

const TONES = {
  // A tinted block with a coloured rule down its left edge. Both colours are
  // per-event-type and arrive at render time, so they are inline style rather
  // than classes — no utility can express a value the database supplies.
  event: 'border-l-[3px] transition-[filter,transform] hover:brightness-[0.98] active:scale-[0.99]',
  // A white block with a border. It carries no type colour, so it needs an
  // outline to separate it from the cell.
  deadline: 'bg-white border border-line transition-colors hover:border-line-strong',
};

/**
 * One entry inside a day cell — an event or a deadline.
 *
 * @param {'event'|'deadline'} props.tone Which of the two kinds of entry this is.
 * @param {boolean} props.compact The month grid's tighter geometry; the week grid uses the roomier one.
 * @param {string} props.accent Event only: the colour of the left rule, supplied per event type.
 * @param {string} props.background Event only: the tinted fill that goes with `accent`.
 * @param {boolean} props.dimmed Fades the entry — a deadline that is already done.
 * @param {React.ReactNode} props.leading Icon or dot before the title.
 * @param {React.ReactNode} props.title The entry's own text; it truncates rather than wraps.
 * @param {React.ReactNode} props.trailing Pushed to the far end — the padlock on a private event.
 * @param {React.ReactNode} props.meta A second line under the title, shown only in the roomier geometry.
 * @param {(event) => void} props.onClick Opens the entry.
 * @param {string} props.className Placement in the parent only.
 */
export default function CalendarEntry({
  tone = 'event',
  compact = false,
  accent,
  background,
  dimmed = false,
  leading,
  title,
  trailing,
  meta,
  onClick,
  className = '',
  ...props
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={tone === 'event' ? { backgroundColor: background, borderLeftColor: accent } : undefined}
      className={`w-full rounded-[8px] text-left ${TONES[tone] ?? TONES.event} ${
        compact ? 'px-[7px] py-[5px]' : 'px-[9px] py-[7px]'
      } ${dimmed ? 'opacity-50' : ''} ${className}`}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {leading}
        <span className={`truncate font-bold text-ink ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{title}</span>
        {trailing}
      </span>
      {meta && <span className="mt-1 block text-[10px] text-muted">{meta}</span>}
    </button>
  );
}
