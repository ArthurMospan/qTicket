'use client';
import React, { forwardRef } from 'react';
import { Clock } from 'lucide-react';

/**
 * A time field. The native `type="time"` control with the kit's geometry over
 * it, so the platform keeps the keyboard, the locale and the clock popup.
 *
 * @param {string} props.value `HH:MM`.
 * @param {(value: string) => void} props.onChange Fires with the new `HH:MM`.
 * @param {boolean|string} props.error Draws the error border and tints the field.
 * @param {boolean} props.disabled Unavailable: dimmed and not editable.
 * @param {'sm'|'md'|'lg'} props.size Control height token.
 * @param {string} props.className Placement in the parent only.
 */
export const TimePicker = forwardRef(({
  value = '',
  onChange,
  error,
  disabled = false,
  className = '',
  size = 'lg',
  ...props
}, ref) => {
  return (
    <div className={`relative w-full ${className}`}>
      <Clock
        size={14}
        className="absolute left-[12px] top-1/2 -translate-y-1/2 text-muted pointer-events-none"
      />
      <input
        ref={ref}
        type="time"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        data-ui-size={size}
        className={`
          ui-time-input
          ui-control w-full bg-canvas border border-transparent rounded-[10px]
          text-[13px] text-ink focus:border-ink outline-none
          transition-colors placeholder:text-muted flex items-center
          pl-[36px] pr-[12px]
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${error ? 'border-danger focus:border-danger bg-danger-soft' : ''}
        `}
        {...props}
      />
    </div>
  );
});
TimePicker.displayName = 'TimePicker';
