'use client';

// ─── UI Kit: Calendar Day Number ─────────────────────────────────────────────
// The date in the corner of a day cell, which is also the control that opens
// that day. Part of the calendar's own vocabulary, beside `CalendarEntry` and
// `CalendarHourSlot`.

import React from 'react';

const STATES = {
  today: 'bg-ink text-white',
  default: 'text-ink hover:bg-canvas',
  // A day belonging to the month either side of the one on screen.
  outside: 'text-faint',
};

// Two sizes, because the same mark has to fit two grids. `md` is the month
// cell's corner; `sm` is the seven-across strip the timesheet puts on a phone,
// where a 28px circle in a 40px-wide tile leaves no room for the day it belongs
// to. Nothing between them: a third size would be a call site guessing.
const SIZES = {
  md: 'h-7 w-7 text-[11px]',
  sm: 'h-5 w-5 text-[10px]',
};

/**
 * The date in the corner of a day cell, and the control that opens that day.
 *
 * Without an `onClick` it is a plain mark rather than a button. The timesheet's
 * month grid needs the same ink circle for today, but there the whole tile is
 * the control — and a button inside a button is not a thing a browser or a
 * screen reader can make sense of.
 *
 * @param {'today'|'default'|'outside'} props.state Which day this is relative to today and to the month on screen.
 * @param {'md'|'sm'} props.size The month cell's corner, or the narrow strip a phone shows a week in.
 * @param {React.ReactNode} props.children The date itself.
 * @param {(event) => void} props.onClick Opens the day. Omitted where the day is already inside a control.
 * @param {string} props.className Placement in the parent only.
 */
export default function CalendarDayNumber({ state = 'default', size = 'md', children, onClick, className = '', ...props }) {
  const shape = `inline-flex shrink-0 items-center justify-center rounded-full font-bold ${
    SIZES[size] ?? SIZES.md
  } ${STATES[state] ?? STATES.default} ${className}`;

  if (!onClick) {
    return <span className={shape} {...props}>{children}</span>;
  }

  return (
    <button type="button" onClick={onClick} className={shape} {...props}>
      {children}
    </button>
  );
}
