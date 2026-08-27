'use client';

// ─── UI Kit: Time Tracking Control ───────────────────────────────────────────
// The timer half of the task attribute strip: a 22px start/stop square and the
// running total beside it, which doubles as the button that opens the log.
//
// Two hand-written controls sharing one 22px row, and the only place in the
// product where a control turns red to mean "running". That state had no
// representation in the kit, so nothing could show what a running timer looks
// like without opening a task and starting one.
//
// Moved with its classes intact, including the 1px nudge on the play triangle —
// lucide's Play is optically left-heavy at 10px, and `translate-x-[1px]` is what
// centres it in the square.

import React from 'react';
import { Play, Square as StopIcon } from 'lucide-react';

/**
 * The timer half of the task attribute strip: a 22px start/stop square and the
 * running total beside it, which doubles as the button that opens the log. The
 * only place in the product where a control turns red to mean "running".
 *
 * @param {boolean} props.running Whether a timer is counting on this task right now.
 * @param {boolean} props.disabled Unavailable: neither half responds.
 * @param {() => void} props.onToggle Starts or stops the timer.
 * @param {() => void} props.onOpen Opens the time log.
 * @param {string} props.spentLabel Total logged, already formatted.
 * @param {string} props.estimateLabel The estimate, already formatted, printed after the total.
 */
export default function TimeTrackingControl({
  running = false,
  disabled = false,
  onToggle,
  onOpen,
  spentLabel,
  estimateLabel,
}) {
  return (
    <div className="flex h-[22px] min-w-0 items-center gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        aria-label={running ? 'Зупинити таймер' : 'Запустити таймер'}
        title={running ? 'Зупинити таймер' : 'Запустити таймер'}
        // `disabled` was declared, wired to the button, and invisible: the
        // square looked exactly the same whether or not it could be pressed.
        // The state matrix is where that showed up — the disabled cell was a
        // photograph of the resting one.
        className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] leading-none transition-colors disabled:opacity-50 ${running ? 'bg-danger-solid text-white hover:bg-danger' : 'bg-line text-ink hover:bg-faint'}`}
      >
        {running ? (
          <StopIcon size={10} className="block fill-current" />
        ) : (
          <Play
            size={10}
            strokeWidth={0}
            className="block translate-x-[1px] fill-current"
          />
        )}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onOpen}
        className="min-w-0 truncate text-[11px] font-bold text-ink disabled:text-muted"
        aria-label="Відкрити трекінг часу"
      >
        {spentLabel}
        {estimateLabel && <span className="font-medium text-muted max-sm:hidden"> / {estimateLabel}</span>}
      </button>
    </div>
  );
}
