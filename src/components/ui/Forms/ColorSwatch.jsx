'use client';

// ─── UI Kit: Colour Swatch ───────────────────────────────────────────────────
// A round dot of a colour you can press. Two roles, and they are genuinely
// different controls rather than two sizes of one: `trigger` shows the colour
// something currently is and opens the palette, `choice` is one option inside
// that palette.
//
// The looks are unchanged from what the settings page drew by hand — that was
// the instruction. What moves into the kit is that both are one control with
// one way of saying "this is the colour" and one way of saying "this one is
// picked", instead of a ring on one and an outline on the other with no rule
// behind the difference.

import React from 'react';

const SIZES = {
  // 14px, with a ring that only appears under the pointer: the trigger reports
  // a colour rather than a selection, so it has no picked state of its own.
  trigger: 'h-[14px] w-[14px] rounded-full ring-2 ring-transparent ring-offset-2 transition-all hover:ring-ink/20',
  // 18px, and it grows slightly under the pointer because a palette is a row of
  // targets and the one you are about to hit should say so.
  choice: 'h-[18px] w-[18px] rounded-full transition-transform hover:scale-110',
  // 44px, and it says "picked" with a ring rather than an outline because at
  // this size an outline reads as a border on the swatch itself.
  theme: 'h-[44px] w-[44px] rounded-full transition-all',
};

const THEME_STATE = {
  on: 'ring-2 ring-ink ring-offset-2',
  off: 'ring-1 ring-line hover:ring-muted',
};

/**
 * A round colour dot you can press — the current colour, or one option in a
 * palette.
 *
 * @param {string} props.color The colour it stands for; it arrives from the database, so it is inline style.
 * @param {'trigger'|'choice'|'theme'} props.size Which role this dot plays: the current colour, one option in a palette, or a 44px theme option.
 * @param {boolean} props.selected `choice` and `theme`: this is the one currently picked.
 * @param {string} props.label Accessible name — the dot has no text of its own.
 * @param {(event) => void} props.onClick Opens the palette, or picks this colour.
 * @param {string} props.className Placement in the parent only.
 */
export default function ColorSwatch({
  color,
  size = 'choice',
  selected = false,
  label,
  onClick,
  className = '',
  ...props
}) {
  return (
    <button
      // Spread first: a call site may add a title or a data attribute, but it
      // must not be able to replace the swatch's own background or geometry.
      {...props}
      type="button"
      aria-label={label}
      aria-pressed={size === 'trigger' ? undefined : selected}
      onClick={onClick}
      style={{
        background: color,
        outline: size === 'choice' && selected ? '2px solid #1f1f1f' : 'none',
        outlineOffset: 2,
      }}
      className={`${SIZES[size] ?? SIZES.choice} ${
        size === 'theme' ? (selected ? THEME_STATE.on : THEME_STATE.off) : ''
      } ${className}`}
    />
  );
}
