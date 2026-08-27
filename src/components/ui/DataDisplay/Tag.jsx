'use client';
import React from 'react';
import { Tag as TagIcon, X } from 'lucide-react';

function hexToRgba(hex, alpha) {
  if (!hex) return 'transparent';
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * A user-created label on a task, with the colour the user picked for it and an
 * optional remove button. `Pill` is the general chip; this is the one that
 * carries a label entity.
 *
 * @param {string} props.label Label text.
 * @param {() => void} props.onRemove Renders the × button. Omit for read-only contexts.
 * @param {'default'|string} props.variant Fallback palette used when `color` is not given.
 * @param {boolean} props.showIcon Shows the tag glyph before the text.
 * @param {string} props.color The label's own hex colour; tints background and text.
 * @param {'small'|'default'} props.size Type scale and height.
 * @param {string} props.className Placement in the parent only.
 */
export default function Tag({
  label,
  onRemove,
  variant = 'default',
  showIcon = true,
  color = null,
  size = 'default',
  className = '',
}) {
  const variants = {
    default: 'bg-ink/5 text-ink',
    success: 'bg-success-solid/8 text-success',
    warning: 'bg-warning-solid/8 text-warning',
    danger: 'bg-danger-solid/8 text-danger',
    error: 'bg-danger-solid/8 text-danger',
    info: 'bg-info-solid/8 text-info',
  };

  const sizeMap = {
    default: 'px-[10px] py-[3px] rounded-[8px] text-[11px] gap-1.5',
    small: 'px-[6px] py-[1.5px] rounded-[6px] text-[10px] gap-[4px]',
  };

  const vClass = color ? '' : (variants[variant] || variants.default);
  const dynamicStyle = color ? {
    background: hexToRgba(color, 0.08),
    color: color
  } : {};

  return (
    <div
      className={`inline-flex items-center font-medium backdrop-blur-[2px] ${sizeMap[size]} ${vClass} ${className}`}
      style={dynamicStyle}
    >
      {showIcon && <TagIcon size={size === 'small' ? 8 : 10} className="shrink-0 opacity-70" />}
      <span>{label}</span>
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Прибрати мітку ${label}`}
          className="hover:opacity-70 transition-opacity p-0.5 ml-0.5 shrink-0"
        >
          <X size={size === 'small' ? 8 : 10} className="stroke-[2.5]" />
        </button>
      )}
    </div>
  );
}
