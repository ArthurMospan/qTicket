'use client';

// ─── UI Kit: Title Input ─────────────────────────────────────────────────────
// The page title while it is being edited: type at heading size, no box, a rule
// underneath. It is what an `h1` turns into when you press Редагувати.
//
// Deliberately not a variant of `Input`. `Input` is a filled control — it owns
// `bg-canvas`, a full border and horizontal padding as utilities, and this
// draws none of them. A variant could only try to cancel those with more
// utilities, and Tailwind resolves same-specificity utilities by their order in
// the generated stylesheet rather than the order they are written in the class
// attribute, so `bg-transparent` beating `bg-canvas` would be luck, not design.
// A control with different chrome is a different control.

import React, { forwardRef } from 'react';

/**
 * The page title while it is being edited: heading type, no box, a rule
 * underneath. What an `h1` turns into when you press Редагувати. Everything
 * else — `value`, `onChange`, `placeholder` — reaches the native input.
 *
 * @param {string} props.className Placement in the parent only.
 */
const TitleInput = forwardRef(function TitleInput({ className = '', ...props }, ref) {
  return (
    <input
      ref={ref}
      // `leading-tight` is stated rather than inherited. Without it the line
      // box came from the page — 36px on a 24px font, body leading applied to a
      // heading — and the box stood 42px tall where the calendar's own copy of
      // this input, which did state it, stood 36px. The declared value wins
      // over the inherited accident.
      //
      // `rounded-none` for the same class of reason. The global `:focus-visible`
      // rule sets a border-radius so the focus ring follows the control's own
      // corners — right for every filled control, and wrong here: this one has
      // no box, only a rule underneath, so the radius arrived on focus and bent
      // the two ends of that rule upward. A control that draws its own chrome
      // states its own corners.
      className={`text-[24px] font-bold text-ink tracking-tight leading-tight bg-transparent border-b-2 border-ink rounded-none pb-1 outline-none w-full ${className}`.trim()}
      {...props}
    />
  );
});

export default TitleInput;
