'use client';
import React, { useEffect, useId, useRef } from 'react';
import { Check, Minus } from 'lucide-react';

/**
 * A checkbox. The native input stays in the DOM and keeps the focus and checked
 * state; the visible box is drawn beside it and follows through `peer-*`, which
 * is why keyboard focus and screen readers still work on a fully custom shape.
 *
 * @param {boolean} props.checked Whether it is ticked.
 * @param {boolean} props.indeterminate Some of what it stands for is ticked and
 *   some is not — a header box over a list where part of the rows are selected.
 *   Drawn as a dash, and it is not a third value the caller can be given back:
 *   clicking it reports `checked`, because «some» is not something to become.
 * @param {(checked: boolean) => void} props.onChange Fires with the new value.
 * @param {boolean} props.disabled Unavailable: dimmed and not clickable.
 * @param {'sm'|'md'|'lg'} props.size Box size.
 * @param {string} props.label Text beside the box; clicking it toggles.
 * @param {string} props.ariaLabel Accessible name when the text beside the box is not this component's to draw — a row that prints its own.
 * @param {boolean|string} props.error Draws the error border.
 * @param {string} props.id Id for the native input; generated when omitted.
 * @param {string} props.className Placement in the parent only.
 */
export default function Checkbox({
  checked = false,
  indeterminate = false,
  onChange,
  disabled = false,
  size = 'md', // sm, md, lg
  label,
  // `ToggleSwitch` has had this since it was written; the checkbox had not, so
  // a caller whose text lives outside the component had no way to name it and
  // fell back to a raw <input> with its own aria-label.
  ariaLabel,
  error,
  id,
  className = '',
}) {
  const sizeMap = {
    sm: { box: 'w-4 h-4 rounded-[4px]', icon: 10 },
    md: { box: 'w-[18px] h-[18px] rounded-[5px]', icon: 12 },
    lg: { box: 'w-5 h-5 rounded-[6px]', icon: 14 },
  };

  const { box, icon } = sizeMap[size];
  const generatedId = useId();
  const checkboxId = id || generatedId;
  // `indeterminate` exists only as a DOM property — there is no attribute for
  // it — so it is written onto the node rather than rendered.
  const inputRef = useRef(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = Boolean(indeterminate) && !checked;
  }, [checked, indeterminate]);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="checkbox"
          id={checkboxId}
          aria-label={label ? undefined : ariaLabel}
          checked={checked}
          onChange={(e) => !disabled && onChange?.(e.target.checked)}
          disabled={disabled}
          className="sr-only peer"
        />
        {/* A `<label>`, not a div with a click handler: the box is a picture of
            the native input beside it, and pointing a label at that input is
            what makes clicking the picture toggle it — natively, with the
            disabled state already respected and nothing to reach by keyboard
            that the input does not already own. */}
        <label
          htmlFor={checkboxId}
          className={`
            ${box} flex items-center justify-center shrink-0
            bg-white border-2 border-line transition-all cursor-pointer
            peer-checked:bg-ink peer-checked:border-ink
            peer-indeterminate:bg-ink peer-indeterminate:border-ink
            peer-focus-visible:ring-2 peer-focus-visible:ring-ink/20 peer-focus-visible:ring-offset-0
            hover:border-line-strong
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            ${error ? 'border-danger' : ''}
          `}
        >
          {checked
            ? <Check size={icon} className="text-white" />
            : indeterminate && <Minus size={icon} className="text-white" />}
        </label>
      </div>

      {label && (
        <label
          htmlFor={checkboxId}
          className={`text-[13px] font-semibold text-ink select-none cursor-pointer ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {label}
        </label>
      )}

      {error && <span className="text-[11px] text-danger ml-1">{error}</span>}
    </div>
  );
}
