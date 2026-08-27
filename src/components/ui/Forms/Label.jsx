'use client';
import React from 'react';

// A required field is announced in words on the right instead of a red
// asterisk: the asterisk carried no meaning for anyone who had not learned the
// convention, and it read as an error state on an untouched form.
// An `icon` is a named prop rather than something callers hand-place in
// `children`. Preflight renders `svg` as `display: block`, so an icon dropped
// into the plain text span claims its own line and lands above the label text.
// Callers worked around that with `className="flex items-center"`, which
// applies to the outer label — already a flex row — and never reaches the span.
// The icon size is fixed by the kit for the same reason the typography is.
/**
 * The caption above a field. Usually reached through `FormGroup`; used directly
 * where a control needs a caption without a field wrapper.
 *
 * @param {React.ReactNode} props.children Caption text.
 * @param {boolean} props.required Prints the required hint on the right.
 * @param {string} props.requiredHint The words that hint uses.
 * @param {string} props.htmlFor Id of the control this labels.
 * @param {React.ComponentType} props.icon Leading glyph, sized by the kit — passing one through `children` breaks the line box.
 * @param {'field'|'inline'} props.context Type scale: above a field, or beside one.
 * @param {string} props.className Placement in the parent only.
 */
export default function Label({
  children,
  required = false,
  requiredHint = 'обов’язково',
  htmlFor,
  icon: Icon = null,
  context = 'field',
  className = '',
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`${context === 'inline' ? 'ui-label-inline' : 'ui-label'} flex select-none items-center gap-2 ${className}`}
    >
      {Icon ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Icon size={13} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0">{children}</span>
        </span>
      ) : (
        <span className="min-w-0">{children}</span>
      )}
      {required && (
        <span className="ml-auto shrink-0 text-[10px] font-medium normal-case tracking-normal text-faint">
          {requiredHint}
        </span>
      )}
    </label>
  );
}
