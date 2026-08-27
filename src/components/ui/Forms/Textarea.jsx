'use client';
import React, { forwardRef } from 'react';

// Which ground the field sits on. Canvas is the default because most fields
// sit on white; a field placed *on* the canvas — the inline «додати завдання»
// on a board column — disappeared into it, and the caller could not fix that
// with a class because the component writes its own background as a utility.
const SURFACES = {
  canvas: 'bg-canvas border-transparent',
  white: 'bg-white border-line',
};

/**
 * Multi-line text field. Like `Input`, anything not named here — `value`,
 * `disabled`, `onChange` — reaches the native textarea through the rest spread.
 *
 * @param {boolean|string} props.error Draws the error border; the message itself belongs to `FormGroup`.
 * @param {string} props.placeholder Placeholder text.
 * @param {number} props.rows Initial visible rows.
 * @param {number} props.maxRows Ceiling for auto-growth, where the caller grows it.
 * @param {'canvas'|'white'} props.surface Which ground it sits on; `white` is for a field placed on the canvas itself.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {string} props.className Placement in the parent only.
 */
export const Textarea = forwardRef(({
  className = '',
  placeholder,
  error,
  rows = 4,
  maxRows,
  surface = 'canvas',
  composition,
  ...props
}, ref) => {
  return (
    <div className="w-full">
      <textarea
        ref={ref}
        rows={rows}
        placeholder={placeholder}
        data-ui-composition={composition}
        className={`
          ui-textarea w-full border rounded-[10px] ${SURFACES[surface] ?? SURFACES.canvas}
          text-[13px] text-ink focus:border-ink outline-none
          transition-colors placeholder:text-muted resize-none
          disabled:opacity-50 disabled:cursor-not-allowed
          px-[12px] py-[10px]
          ${error ? 'border-danger focus:border-danger bg-danger-soft' : ''}
          ${className}
        `}
        {...props}
      />
    </div>
  );
});
Textarea.displayName = 'Textarea';
