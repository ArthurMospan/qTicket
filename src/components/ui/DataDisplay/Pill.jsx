'use client';

import React from 'react';

/**
 * The kit's one label chip. Every status, type, priority and count badge in the
 * product is this component or a thin wrapper over it (`StatusPill`,
 * `TypeBadge`), which is why its geometry lives in `globals.css` under
 * `data-ui-pill-*` and not in any call site.
 *
 * @param {React.ReactNode} props.children Label as content; `label` does the same and wins where both are given.
 * @param {string} props.label Label as a prop, for call sites that pass data rather than markup.
 * @param {React.ComponentType} props.icon Leading lucide icon, sized from `size`.
 * @param {string} props.tone Named colour role. Ignored when `color` is set.
 * @param {string} props.size Height and type scale token.
 * @param {'capsule'|'badge'|string} props.shape Corner radius token.
 * @param {'subtle'|'solid'|'outline'|'soft-outline'} props.appearance Fill weight.
 * @param {string} props.preset A named pairing of tone, size and shape used in more than one place.
 * @param {string} props.color Arbitrary hex, for user-chosen colours (labels, statuses) that no token can name.
 * @param {string} props.colorAlpha Hex alpha suffix for the background when `color` is set.
 * @param {boolean} props.uppercase Upper-cases the label.
 * @param {'bold'|'medium'} props.weight Font weight.
 * @param {string} props.className Placement in the parent only.
 */
export default function Pill({
  children,
  label,
  icon: Icon,
  tone = 'neutral',
  size = 'sm',
  shape = 'capsule',
  appearance = 'subtle',
  preset,
  color,
  colorAlpha = '18',
  uppercase = false,
  weight = 'bold',
  className = '',
  ...props
}) {
  const customStyle = color
    ? { color, backgroundColor: `${color}${colorAlpha}` }
    : undefined;

  return (
    <span
      {...props}
      data-ui-pill-tone={color ? 'custom' : tone}
      data-ui-pill-size={size}
      data-ui-pill-shape={shape}
      data-ui-pill-appearance={appearance}
      data-ui-pill-preset={preset}
      className={`ui-pill ${weight === 'medium' ? '!font-medium' : ''} ${uppercase ? 'uppercase tracking-wider' : ''} ${className}`}
      style={customStyle}
    >
      {Icon ? <Icon size={size === 'lg' ? 12 : 10} strokeWidth={2} aria-hidden /> : null}
      {label ?? children}
    </span>
  );
}
