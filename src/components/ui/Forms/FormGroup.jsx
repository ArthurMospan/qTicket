'use client';
import React from 'react';
import Label from './Label';

/**
 * One field: caption above, control inside, error message below. The error
 * lives here rather than in each control so every form prints it in the same
 * place, in the same size, at the same distance.
 *
 * @param {React.ReactNode} props.children The control.
 * @param {string} props.label Caption text.
 * @param {string} props.error Message under the control. Falsy prints nothing.
 * @param {React.ComponentType} props.icon Leading glyph on the caption.
 * @param {boolean} props.required Prints the required hint on the caption.
 * @param {'sm'|'md'} props.gap Distance between caption, control and message.
 * @param {string} props.className Placement in the parent only.
 */
export default function FormGroup({
  children,
  label,
  error,
  icon = null,
  required = false,
  gap = 'sm',
  className = '',
}) {
  const gapClass = gap === 'md' ? 'gap-[8px]' : 'gap-[6px]';

  // The caption and the control were two siblings that never knew about each
  // other: the label carried no `htmlFor` and the control no `id`, so every
  // field in the product announced itself as an unnamed textbox and clicking a
  // caption focused nothing. The wiring belongs here rather than at each call
  // site, which is the same reason the error message does.
  const fieldId = React.useId();
  const errorId = `${fieldId}-error`;
  const single = React.isValidElement(children) ? children : null;
  const control = single
    ? React.cloneElement(single, {
      id: single.props.id ?? fieldId,
      'aria-invalid': error ? true : single.props['aria-invalid'],
      'aria-describedby': error ? errorId : single.props['aria-describedby'],
      // Only these three. Passing the caption down as `ariaLabel` for the
      // components that render a trigger instead of a field looked harmless and
      // was not: `Input` forwards every unknown prop to its native input, so
      // React logged "Invalid ARIA attribute `ariaLabel`" on every field in the
      // product. A component that needs the caption as its own name takes
      // `ariaLabel` from its own call site.
    })
    : children;

  return (
    <div className={`flex flex-col ${gapClass} ${className}`}>
      {label && (
        <Label htmlFor={single ? (single.props.id ?? fieldId) : undefined} required={required} icon={icon}>
          {label}
        </Label>
      )}
      {control}
      {error && (
        <span id={errorId} className="text-[11px] text-danger mt-[2px] block">{error}</span>
      )}
    </div>
  );
}
