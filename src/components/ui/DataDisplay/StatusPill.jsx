'use client';

import Pill from './Pill';

/**
 * A workflow status, drawn as the badge-shaped `Pill` in the status's own
 * colour. It exists so no screen has to remember that pairing.
 *
 * @param {string} props.label Status name as the workspace spells it.
 * @param {string} props.color The status's configured hex colour.
 * @param {string} props.className Placement in the parent only.
 */
export default function StatusPill({
  label,
  color = '#9a9a9a',
  className = '',
}) {
  return (
    <Pill
      label={label}
      color={color}
      size="sm"
      shape="badge"
      className={className}
    />
  );
}
