'use client';

/**
 * A switch: it turns something on, immediately, with no save step. Where the
 * change only takes effect on submit, that is a `Checkbox`.
 *
 * @param {boolean} props.checked Whether it is on.
 * @param {(checked: boolean) => void} props.onChange Fires with the new value.
 * @param {boolean} props.disabled Unavailable: dimmed and not clickable.
 * @param {'sm'|'md'|'lg'} props.size Track and knob size.
 * @param {string} props.label Text beside the switch.
 * @param {string} props.ariaLabel Accessible name when there is no visible label.
 * @param {string} props.className Placement in the parent only.
 */
export default function ToggleSwitch({
  checked = false,
  onChange,
  disabled = false,
  size = 'md', // sm, md, lg
  label,
  ariaLabel,
  className = '',
}) {
  const sizeMap = {
    sm: { width: '36px', height: '20px', dotSize: '16px', translateX: 16 },
    md: { width: '44px', height: '24px', dotSize: '20px', translateX: 20 },
    lg: { width: '56px', height: '32px', dotSize: '28px', translateX: 24 },
  };

  const size_config = sizeMap[size] || sizeMap.md;

  const containerStyle = {
    width: size_config.width,
    height: size_config.height,
  };

  const dotStyle = {
    width: size_config.dotSize,
    height: size_config.dotSize,
    transform: checked ? `translateX(${size_config.translateX}px)` : 'translateX(0px)',
    transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1), background-color 200ms ease-in-out',
  };

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || label}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        style={containerStyle}
        className={`
          relative inline-flex flex-shrink-0 rounded-full p-0
          transition-colors duration-200
          ${checked ? 'bg-ink' : 'bg-line'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          focus:outline-none focus:ring-2 focus:ring-ink/20 focus:ring-offset-0
        `}
      >
        <div
          style={dotStyle}
          className="absolute top-[2px] left-[2px] bg-white rounded-full"
        />
      </button>
      {label && (
        <span className={`text-[13px] font-semibold text-ink select-none ${disabled ? 'opacity-50' : ''}`}>
          {label}
        </span>
      )}
    </div>
  );
}

// A static marker rather than `type.name`, which minification rewrites: a
// settings row uses it to tell "a switch, which fits beside its label" from
// "a control that needs the width of the screen". Same convention as
// `FilterBar.isFilterBar`.
ToggleSwitch.isSwitch = true;
