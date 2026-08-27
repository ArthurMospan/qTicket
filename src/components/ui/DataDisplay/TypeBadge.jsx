'use client';

import Pill from './Pill';

/**
 * An issue type (task, bug, story…) with its glyph, drawn as a lighter-tinted
 * `Pill` than `StatusPill` so type never competes with status for attention.
 *
 * @param {string} props.label Type name.
 * @param {string} props.color The type's configured hex colour.
 * @param {React.ComponentType} props.icon The type's lucide glyph.
 * @param {string} props.className Placement in the parent only.
 */
export default function TypeBadge({
  label,
  color = '#9a9a9a',
  icon: Icon,
  className = '',
}) {
  return (
    <Pill
      label={label}
      icon={Icon}
      color={color}
      colorAlpha="14"
      size="sm"
      shape="badge"
      className={`!font-medium backdrop-blur-[2px] ${className}`}
    />
  );
}
