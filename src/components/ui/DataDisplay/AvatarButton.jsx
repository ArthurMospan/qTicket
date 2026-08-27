'use client';

import React from 'react';
import UserAvatar from './UserAvatar';

// ─── UI Kit: Avatar Button ───────────────────────────────────────────────────
// An avatar that is a control: opens a profile, or anchors a popover.
//
// `UserAvatar` deliberately stays a picture — it renders in lists, headers and
// mention rows where nothing is clickable. So every screen that *did* want a
// clickable one wrapped it by hand, and the three wrappers disagreed about the
// same hover: `hover:opacity-80` in the timeline, `cursor-pointer
// hover:opacity-80` in the chat row, and a third copy for the external-author
// popover. One wrapper, one hover.
//
// Positioning stays at the call site (`col-start-2`, `self-end`): where the
// button sits in its parent is composition, not chrome.
/**
 * An avatar that is a control: opens a profile, or anchors a popover.
 *
 * @param {object} props.user The person to draw.
 * @param {string} props.size Named token from the avatar scale, shared with `UserAvatar`.
 * @param {string} props.label Accessible name — a face names nobody to a screen reader.
 * @param {() => void} props.onClick Click handler.
 * @param {string} props.className Placement in the parent only.
 */
export default function AvatarButton({
  user,
  size = 'md',
  label,
  onClick,
  className = '',
  ...props
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`block shrink-0 cursor-pointer transition-opacity hover:opacity-80 ${className}`}
      {...props}
    >
      <UserAvatar user={user} size={size} />
    </button>
  );
}
