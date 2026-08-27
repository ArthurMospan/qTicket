'use client';
import { useState } from 'react';
import Tooltip from '@/components/ui/Navigation/Tooltip';

// The avatar scale — the single place that decides how big an avatar is.
//
// `size` used to take a raw number, and 38 call sites each picked their own:
// 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 42, 48, 100. Fifteen values
// for one visual role meant there was no scale to change — resizing avatars
// across the product would have been a 38-file edit.
export const AVATAR_SIZES = {
  xs: 16,
  sm: 24,
  md: 32,
  lg: 40,
  xl: 48,
  hero: 96,

  // Chat is its own structure with its own rhythm: a message row is built
  // around a 36px avatar, and folding these into the generic scale shifted
  // every row by 4px. These names exist only for chat surfaces.
  'chat-message': 36,
  'chat-member': 28,
  'chat-inline': 20,
  'chat-mention': 18,
};

// A raw number is still accepted, but only for genuinely computed sizes —
// AvatarGroup derives one from its own scale, and WorkloadTab switches on
// layout. Those cannot name a token without inventing one per caller. Fixed
// call sites use a token; the drift report keeps the numeric ones visible.
function resolveAvatarSize(size) {
  if (typeof size === 'number') return size;
  return AVATAR_SIZES[size] ?? AVATAR_SIZES.md;
}

// src/components/UserAvatar.jsx — Fixed: uses size prop, supports avatar/photoURL
// `stacked` is the overlapping-avatars ring. It was previously written at the
// call site as `border-2 border-white` in one place and `ring-2 ring-white` in
// AvatarGroup — the same visual idea, spelled two different ways, neither of
// which the kit knew about.
/**
 * A person's face, or their initials on a colour derived from their id.
 * Deliberately a picture and not a control: it renders in lists, headers and
 * mention rows where nothing is clickable. Where it must be clickable, that is
 * `AvatarButton`.
 *
 * @param {object} props.user The person; the photo, the name and the fallback colour all come from this.
 * @param {string|number} props.size Named token from the avatar scale; a raw number only where a measured layout needs one.
 * @param {boolean} props.stacked Adds the white ring that separates overlapping avatars.
 * @param {boolean} props.tooltip Shows the person's name on hover.
 * @param {string} props.className Placement in the parent only.
 */
export default function UserAvatar({ user, size = 'md', stacked = false, className = '', tooltip = false }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState(null);
  const px = resolveAvatarSize(size);
  const stackedClass = stacked ? 'ring-2 ring-white' : '';

  if (!user) return (
    <div style={{ width: px, height: px, minWidth: px }} aria-hidden="true"
      className={`rounded-full bg-line flex items-center justify-center shrink-0 ${className}`}>
      <span style={{ fontSize: px * 0.38 }} className="font-bold text-muted">?</span>
    </div>
  );

  const avatarUrl = user.customAvatar || user.avatar || user.photoURL;
  const showAvatarImage = Boolean(
    avatarUrl
    && failedAvatarUrl !== avatarUrl
  );
  const name = user.name || user.email || '?';
  const initials = name.charAt(0).toUpperCase();

  // Deterministic dark color from ID or name, with user.avatarColor support
  const colors = ['#4f46e5','#0891b2','#059669','#d97706','#dc2626','#7c3aed','#db2777'];
  const avatarColor = user.avatarColor || user.color;

  let bg = avatarColor;
  if (!bg) {
    const hashInput = String(user.id || user.uid || name);
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      hash = hashInput.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIdx = Math.abs(hash) % colors.length;
    bg = colors[colorIdx];
  }

  const avatar = (
    <div style={{ width: px, height: px, minWidth: px }}
      className={`rounded-full overflow-hidden flex items-center justify-center shrink-0 ${stackedClass} ${className}`}>
      {showAvatarImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setFailedAvatarUrl(avatarUrl)}
          style={{ width: px, height: px }}
          className="object-cover"
        />
      ) : (
        <div style={{ width: px, height: px, background: bg }}
          className="flex items-center justify-center" aria-label={name}>
          <span style={{ fontSize: px * 0.38, lineHeight: 1 }} className="font-bold text-white" aria-hidden="true">
            {initials}
          </span>
        </div>
      )}
    </div>
  );

  if (!tooltip) return avatar;
  return (
    <Tooltip content={typeof tooltip === 'string' ? tooltip : name} position="top">
      {avatar}
    </Tooltip>
  );
}
