'use client';

import React from 'react';
import Button from './Button';
import { Tooltip } from './Navigation/Tooltip';

export const APPEARANCES = {
  quiet: '!bg-transparent !text-muted hover:!bg-canvas hover:!text-ink',
  soft: '!bg-canvas !text-muted hover:!bg-line hover:!text-ink',
  // Like `soft`, but the icon carries the weight rather than the fill: a dark
  // glyph on a flat #f1f1f1 disc. Used where the action *is* the control and
  // there is no label beside it to say what it does.
  contrast: '!bg-selected !text-ink hover:!bg-line',
  surface: '!border !border-line !bg-white !text-muted hover:!bg-canvas hover:!text-ink',
  primary: '!bg-ink !text-white hover:!bg-ink/90',
  // The same disc as `surface`, and only its hover differs. It used to carry a
  // shadow as well, which is why the two of them side by side — the notification
  // row's «прочитано» and «видалити» — read as two different controls.
  'surface-danger': '!border !border-line !bg-white !text-muted hover:!bg-danger-soft hover:!text-danger',
  'surface-plain': '!bg-white !text-faint hover:!text-ink',
  overlay: '!bg-black/50 !text-white hover:!bg-black/70',
  inverse: '!bg-white/10 !text-white hover:!bg-white/20',
  'auth-close': '!border !border-white/10 !bg-surface-dark !text-white/70 hover:!bg-white/10 hover:!text-white',
  danger: '!bg-danger-solid !text-white hover:!bg-danger',
  'quiet-danger': '!bg-transparent !text-muted hover:!bg-danger-soft hover:!text-danger',
  // The crown, and only the crown. It sits beside a control that will not move
  // and says why, so it has to be findable without being an advertisement:
  // transparent until the pointer is on it, and the one warm colour on the
  // screen. See `PlanMark`.
  plan: '!bg-transparent !text-plan hover:!bg-plan-soft',
};

export const BUTTON_SIZES = {
  micro: 'icon-xs',
  xs: 'icon-24',
  sm: 'icon-sm',
  compact: 'icon-30',
  md: 'icon',
  lg: 'icon-lg',
  xl: 'icon-xl',
};

/**
 * A square icon-only button. It is `Button` underneath, so it inherits the same
 * control height scale; what it adds is the accessible name, which an icon
 * button has no other way to carry.
 *
 * @param {string} props.label Accessible name and tooltip. Required — an icon alone names nothing.
 * @param {boolean|'top'|'bottom'|'left'|'right'} props.tooltip Show the kit's hover
 *   tooltip instead of the browser's. `true` means «top».
 * @param {React.ComponentType} props.icon lucide icon; its pixel size comes from `size`, never from the call site.
 * @param {'micro'|'xs'|'sm'|'compact'|'md'|'lg'|'xl'} props.size Box size, mapped onto Button's icon sizes.
 * @param {string} props.appearance Fill and hover treatment; the dark ones exist for overlays and dark surfaces.
 * @param {string} props.shape Corner radius token.
 * @param {React.Ref} props.buttonRef Ref to the underlying button, for popovers anchored to it.
 * @param {string} props.className Placement in the parent only.
 */
export default function IconAction({
  label,
  icon,
  size = 'md',
  appearance = 'quiet',
  shape = 'default',
  tooltip = false,
  buttonRef,
  className = '',
  ...props
}) {
  // The doc line above has always said «Accessible name and tooltip», and only
  // the first half was true: `aria-label` names the button for a screen reader
  // and shows a sighted person nothing at all. On a row of one or two icons
  // that is survivable. On the description editor's toolbar it is sixteen
  // unlabelled glyphs, which is where it was noticed.
  //
  // `title` is the default because it costs no markup: it wraps nothing, moves
  // nothing, and works on every icon button in the product at once. `tooltip`
  // opts into the kit's own dark bubble where the extra element is safe —
  // `Tooltip` renders a wrapper around the trigger, and a wrapper is not free
  // inside a flex row or an absolutely positioned corner.
  const control = (
    <Button
      {...props}
      aria-label={label}
      title={tooltip ? undefined : label}
      buttonRef={buttonRef}
      icon={icon}
      size={BUTTON_SIZES[size] ?? BUTTON_SIZES.md}
      shape={shape}
      style="ghost"
      className={`${APPEARANCES[appearance] ?? APPEARANCES.quiet} ${className}`}
    />
  );
  if (!tooltip) return control;
  return (
    <Tooltip
      content={label}
      position={tooltip === true ? 'top' : tooltip}
      className="relative inline-flex shrink-0"
    >
      {control}
    </Tooltip>
  );
}
