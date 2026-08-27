import React, { forwardRef } from 'react';

const INPUT_SIZES = {
  sm: 'text-[12px]',
  md: 'text-[13px]',
  lg: 'text-[13px]',
};

// QUI-133. `money` used to be right-aligned bold text plus a fixed 54px gutter
// and nothing else: it reserved room for a currency suffix the component never
// drew. Each call site drew its own absolutely-positioned span instead — at
// 10px in one place and 9px in another, at two different offsets — and the
// catalogue drew none at all, which is why the preview looked like a bare
// number floating in an empty field. The suffix belongs to the preset that
// reserves space for it, sized from the text rather than from one guess.
const INPUT_PRESETS = {
  money: 'text-right font-bold tabular-nums',
};

/**
 * Single-line text field. Everything it is not given by name — `value`,
 * `placeholder`, `disabled`, `type` — is forwarded to the native input, so it
 * supports the full HTML surface without restating it.
 *
 * @param {boolean|string} props.error Draws the error border; a string is not printed here, `FormGroup` prints it.
 * @param {React.ComponentType} props.icon Leading lucide icon inside the field.
 * @param {'sm'|'md'|'lg'} props.size Control height token, shared with Button and Select.
 * @param {'money'} props.preset A named field role that changes alignment and figures.
 * @param {string} props.suffix Short trailing unit (`₴/г`, `%`) drawn inside the control, with room reserved from its length.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {string} props.className Placement in the parent only.
 */
export const Input = forwardRef(({
  className = '',
  icon: Icon,
  error,
  size = 'lg',
  preset,
  composition,
  // Short trailing unit — a currency, `₴/г`, `%`. Rendered inside the control
  // and given real room, so the value can never slide under it.
  suffix,
  ...props
}, ref) => {
  const sizeClass = INPUT_SIZES[size] ?? INPUT_SIZES.lg;
  const suffixText = suffix ? String(suffix) : '';
  // Room for the label plus the padding either side of it, from its own length
  // rather than one hardcoded number that only ever fitted one caller.
  const suffixPadding = suffixText ? 18 + suffixText.length * 6 : 0;

  return (
    <div className="relative w-full">
      {Icon && (
        <Icon
          size={14}
          className="absolute left-[12px] top-1/2 -translate-y-1/2 text-muted"
        />
      )}
      <input
        ref={ref}
        data-ui-size={size}
        data-ui-composition={composition}
        // The leading icon changes the left padding, and that decision belongs
        // with the rest of the field's geometry rather than in a utility here:
        // a utility is emitted in Tailwind's last layer and would beat any
        // composition that wants the padding for itself.
        data-ui-leading={Icon ? 'icon' : undefined}
        style={suffixText ? { paddingRight: `${suffixPadding}px` } : undefined}
        className={`
          ui-control ui-field ${sizeClass} w-full bg-canvas border border-transparent
          text-ink focus:border-ink outline-none
          transition-colors placeholder:text-muted flex items-center
          disabled:opacity-50 disabled:cursor-not-allowed
          ${error ? 'border-danger focus:border-danger bg-danger-soft' : ''}
          ${INPUT_PRESETS[preset] || ''}
          ${className}
        `}
        {...props}
      />
      {suffixText && (
        <span className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2 text-[11px] font-bold text-muted">
          {suffixText}
        </span>
      )}
    </div>
  );
});
Input.displayName = 'Input';
