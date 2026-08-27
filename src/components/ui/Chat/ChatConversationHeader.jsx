'use client';

import React from 'react';
import { Hash, Info, Pin } from 'lucide-react';
import IconAction from '../IconAction';
import MobilePaneBack from '../Navigation/MobilePaneBack';
import UserAvatar from '../DataDisplay/UserAvatar';
import PresenceDot from '../DataDisplay/PresenceDot';

// ─── UI Kit: Chat Conversation Header ────────────────────────────────────────
// The bar above a conversation: who you are talking to, how many messages are
// pinned, and the way back out on a phone.
//
// /ui-kit already showed this header — as a hand-typed copy inside the composer
// preview, with a plain `<Info>` glyph where the product has a real toggle and
// no pinned counter at all. That copy is gone; the preview renders this.
/**
 * The bar above a conversation: who or what it is, what is pinned, the info
 * toggle, and the way back out on a phone.
 *
 * @param {'channel'|'dm'} props.type A channel gets a hash, a direct message gets a face.
 * @param {string} props.title Channel name, or the other person's name.
 * @param {string} props.subtitle Line under it — member count, or the person's role.
 * @param {string} props.statusEmoji The person's status emoji, for a direct message.
 * @param {string} props.statusTitle Its text, shown on hover.
 * @param {object} props.user The other person, for the avatar.
 * @param {boolean} props.online Whether they are present right now.
 * @param {number} props.pinnedCount How many messages are pinned; zero hides the control.
 * @param {() => void} props.onOpenPinned Opens the pinned list.
 * @param {string} props.infoLabel Accessible name of the info toggle.
 * @param {boolean} props.infoActive Whether the info panel is open — this is the pressed look.
 * @param {() => void} props.onToggleInfo Opens and closes it.
 * @param {() => void} props.onBack Returns to the rail at mobile width.
 */
export default function ChatConversationHeader({
  type = 'channel',
  title,
  subtitle,
  statusEmoji,
  statusTitle,
  user,
  online = false,
  pinnedCount = 0,
  onOpenPinned,
  infoLabel,
  infoActive = false,
  onToggleInfo,
  onBack,
}) {
  return (
    // `rounded-t-*` matters only in Chromium, and it is not decoration there.
    // This bar caps a pane that rounds its corners with `overflow: hidden`, and
    // Chromium does not apply an ancestor's *rounded* clip to a descendant that
    // paints a `backdrop-filter` — the blur fills the corner square while every
    // other browser clips it, which is why the header looked square in Chrome
    // and correct in Firefox. Giving the bar the pane's own radius makes its
    // box the thing being rounded, so no ancestor clip is needed.
    // Below md this bar is the second one on the screen — the workspace header
    // is already fixed 56px above it — so it gives back what it can: eight
    // pixels of height and eight of side padding, all of which the title and
    // the two controls beside it were short of on a 390px screen.
    <div className="relative z-10 flex min-h-[64px] shrink-0 items-center gap-2 rounded-t-[var(--ui-radius-surface)] border-b border-line/70 bg-canvas/90 px-4 py-3 backdrop-blur-xl max-md:min-h-[56px] max-md:gap-1.5 max-md:px-2 max-md:py-2">
      {/* Settings and Team have adopted this arrow, so it is shared now — see
          the note that used to stand here. */}
      <MobilePaneBack onClick={onBack} label="До списку чатів" />
      {type === 'channel' ? (
        <Hash size={17} className="text-ink shrink-0" />
      ) : (
        <div className="relative shrink-0">
          <div className="w-8 h-8 rounded-full overflow-hidden">
            <UserAvatar user={user} size={32} />
          </div>
          {online && <PresenceDot size="sm" collar="canvas" />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h2 className="ui-type-compact-title text-ink truncate flex items-center gap-1.5">
          {title}
          {statusEmoji && (
            <span className="cursor-help" title={statusTitle || 'Статус користувача'}>
              {statusEmoji}
            </span>
          )}
        </h2>
        {subtitle && <p className="text-[11px] text-muted truncate">{subtitle}</p>}
      </div>

      {/* Pinned message count */}
      {pinnedCount > 0 && (
        <button
          type="button"
          onClick={onOpenPinned}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-ink transition-colors hover:border-faint"
        >
          <Pin size={12} />
          <span className="sm:hidden">{pinnedCount}</span>
          <span className="hidden sm:inline">{pinnedCount} закріплено</span>
        </button>
      )}

      {/* Conversation info */}
      <IconAction
        onClick={onToggleInfo}
        icon={Info}
        label={infoLabel}
        appearance={infoActive ? 'soft' : 'quiet'}
        composition="chat-panel-action"
      />
    </div>
  );
}
