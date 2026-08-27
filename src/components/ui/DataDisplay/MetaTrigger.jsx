'use client';

// ─── UI Kit: Meta Trigger ────────────────────────────────────────────────────
// A label, a face and a name, in a row that opens a popover — "Автор: ⬤ Артур",
// "Організатор: ⬤ Олена". It sits in the metadata strip under a title.
//
// Its chrome already lived in the kit as `[data-ui-control='identity-meta-trigger']`
// in globals.css, but the three-element markup that uses it did not, so the task
// page, the calendar page and the catalogue each retyped it — and the catalogue's
// copy was a hand-made lookalike rather than the thing itself. The class stays
// where it is; this owns the markup that goes with it.

import React from 'react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';

/**
 * A label, a face and a name in one row that opens a popover — «Автор: ⬤
 * Артур». It sits in the metadata strip under a title.
 *
 * @param {string} props.label The role this person plays («Автор», «Організатор»).
 * @param {object} props.user The person, for the avatar.
 * @param {string} props.name Displayed name; falls back to the user's own.
 * @param {string} props.className Placement in the parent only.
 */
export default function MetaTrigger({ label, user, name, className = '', ...props }) {
  return (
    <button
      type="button"
      data-ui-control="identity-meta-trigger"
      className={`ui-native-control ${className}`.trim()}
      {...props}
    >
      <span>{label}</span>
      {/* The face and the name are one part, so the hover capsule can start at
          the face on a phone and leave the label flush with the title above it.
          The chrome for both widths is in globals.css. */}
      <span data-ui-part="identity">
        <UserAvatar user={user} size="xs" />
        <span className="font-semibold text-ink">{name}</span>
      </span>
    </button>
  );
}
