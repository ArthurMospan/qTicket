'use client';

import React from 'react';

// ─── UI Kit: Text Action ─────────────────────────────────────────────────────
// A button with no box: type, a colour and a hover, nothing else.
//
// This existed 15 times, hand-written, across five surfaces — «Зберегти» beside
// a chat edit box, «Редагувати» in the channel panel, «ще» in the calendar,
// «Спробувати ще раз» on a task, «Перейти» in the header. Every copy re-picked
// its own font size and its own hover, so the same control was 10px normal in
// one place and 13px semibold in another with no rule behind the difference.
//
// The rule below is read *out of* those fifteen rather than imposed on them:
// the two 10px instances are normal weight and the 11/12px ones are semibold,
// so weight follows size instead of being a separate prop nobody would set
// consistently. Icon size and gap follow size for the same reason — `Button`
// learned that lesson already when its free `iconSize` prop was removed.

const SIZES = {
  xs: 'text-[10px] gap-1',
  sm: 'text-[11px] font-semibold gap-1',
  md: 'text-[12px] font-semibold gap-1.5',
  // 13px is the body size, so this is the one that sits inside running text
  // rather than in chrome: «Спробувати ще раз» on a failed task, the task title
  // in a link row, «Перейти до події» in the calendar.
  lg: 'text-[13px] font-semibold gap-1.5',
};

const ICON_SIZES = { xs: 12, sm: 13, md: 12, lg: 13 };

const TONES = {
  // Primary: the affirmative half of an inline pair (Зберегти, Додати, Перейти).
  ink: 'text-ink hover:underline',
  // Secondary: the quiet half (Скасувати, Редагувати) and quiet navigation.
  muted: 'text-muted hover:text-ink',
  // Destructive and visible about it.
  danger: 'text-danger hover:text-danger',
  // Destructive but resting: an icon that only turns red under the pointer.
  'danger-quiet': 'text-faint hover:text-danger',
};

/**
 * A borderless text button — the inline Зберегти/Скасувати pair, and quiet
 * links inside rows. A `Button` here would out-weigh the content it sits in.
 *
 * @param {React.ReactNode} props.children Label as content.
 * @param {string} props.label Accessible name; needed when the action is icon-only.
 * @param {React.ComponentType} props.icon Leading lucide icon, sized from `size`.
 * @param {'ink'|'muted'|'danger'|'danger-quiet'} props.tone Which half of the pair this is: affirmative, quiet, or destructive.
 * @param {'xs'|'sm'|'md'|'lg'} props.size Type scale.
 * @param {'button'|'submit'} props.type Native button type.
 * @param {string} props.className Placement in the parent only.
 */
export default function TextAction({
  children,
  label,
  icon: Icon,
  tone = 'ink',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}) {
  const sizeClass = SIZES[size] ?? SIZES.md;
  const toneClass = TONES[tone] ?? TONES.ink;

  // Colour *and* opacity. Half of these sit inside a `group-hover` row and fade
  // in with it, so the call site adds `opacity-0 group-hover:opacity-100`. Had
  // this said `transition-colors`, the two would have been the same property in
  // the same layer and whichever Tailwind emitted last would have won.
  return (
    <button
      type={type}
      aria-label={children ? undefined : label}
      // Disabled belongs to the component, not the call site: «Очистити
      // прочитані» is disabled whenever nothing is read, and every call site
      // that needed that was re-inventing the same two utilities.
      className={`inline-flex items-center transition-[color,opacity] disabled:pointer-events-none disabled:opacity-40 ${sizeClass} ${toneClass} ${className}`}
      {...props}
    >
      {Icon && <Icon size={ICON_SIZES[size] ?? ICON_SIZES.md} />}
      {children}
    </button>
  );
}
