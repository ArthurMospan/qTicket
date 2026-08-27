'use client';

// ─── UI Kit: Calendar Day Cell ───────────────────────────────────────────────
// A whole day as a pressable tile — the timesheet's month grid, where one day
// summarises the hours logged against it.
//
// It is the fourth of the calendar's own shapes, beside `CalendarEntry`,
// `CalendarDayNumber` and `CalendarHourSlot`. The month view in the calendar
// itself draws its cells as plain containers because the entries inside them
// are the targets; here the day is the target, so it is a button.

import React from 'react';

const STATES = {
  default: 'border-black/[0.05] bg-white hover:border-black/10 hover:shadow-sm',
  // One ink hairline, and the date inside wears the circle — the same two marks
  // the calendar's own month uses for today, because two calendars in one
  // product that mark today differently are two products. It had been a quarter
  // -opacity border under a 2px ring: a thin grey line with a smudge around it,
  // which is neither a border nor a highlight.
  today: 'border-ink bg-white',
  // A weekend is an ordinary day with nothing expected of it, so it loses only
  // the lift on hover.
  weekend: 'border-black/[0.05] bg-white hover:border-black/10',
  // A day belonging to the month either side of the one on screen.
  outside: 'border-black/[0.03] bg-white/60 opacity-45',
  // The day whose entries are open underneath the grid. On a phone the month
  // is a picker, so the day you are reading has to out-shout everything else
  // in it — and a ring already means «today», which leaves the fill.
  selected: 'border-ink bg-ink shadow-sm',
};

// Two geometries, because the tile answers two different questions. `roomy` is
// the timesheet's, where a day summarises the hours booked against it; `compact`
// is the month on a phone, where forty-two of these share seven columns and a
// day is a number with a few dots under it.
const DENSITIES = {
  roomy: 'min-h-[86px] items-start gap-[6px] rounded-[14px] p-[10px] text-left',
  compact: 'min-h-[44px] items-center justify-center gap-[3px] rounded-[10px] px-[2px] py-[4px] text-center',
};

/**
 * A day of a month grid, as a pressable tile.
 *
 * @param {'default'|'today'|'weekend'|'outside'|'selected'} props.state Which day this is relative to today, the week, the month on screen and the day being read.
 * @param {'roomy'|'compact'} props.density How much room the tile takes: the timesheet's summary, or a phone's month picker.
 * @param {React.ReactNode} props.children The day's own summary — its date and whatever is counted against it.
 * @param {(event) => void} props.onClick Opens the day, or the week around it.
 * @param {string} props.className Placement in the parent only.
 */
export default function CalendarDayCell({ state = 'default', density = 'roomy', children, onClick, className = '', ...props }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex cursor-pointer flex-col border transition-colors ${
        DENSITIES[density] ?? DENSITIES.roomy
      } ${STATES[state] ?? STATES.default} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
