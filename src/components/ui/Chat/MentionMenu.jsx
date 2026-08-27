'use client';

import React from 'react';
import UserAvatar from '../DataDisplay/UserAvatar';

// ─── UI Kit: Mention Menu ────────────────────────────────────────────────────
// The @-menu that opens above a composer while you type a name.
//
// Written twice, once per composer, and the two copies had already drifted:
// the chat menu is a 16px-radius sheet with a shadow and 28px avatars, the task
// timeline a 10px-radius bordered box with 20px avatars — and only the timeline
// one had a keyboard cursor, because only that copy was given one. Both looks
// are real and both stay; what changes is that they are now two declared
// densities of one component instead of two independent pieces of markup.
//
// Where the menu is anchored (`absolute bottom-full left-4 right-4 z-30`) stays
// at the call site: that is the composer's geometry, not the menu's.

const DENSITIES = {
  // Workspace chat: a wide sheet, one row per member with their email under
  // the name, no keyboard cursor.
  composer: {
    list: 'bg-white border border-line rounded-2xl shadow-xl overflow-hidden max-h-[200px] overflow-y-auto',
    row: 'w-full flex items-center gap-3 px-4 py-2.5 hover:bg-canvas transition-colors text-left',
    idle: '',
    selected: '',
    avatar: 'chat-member',
    // Pressing rather than clicking: the composer must not lose focus to the
    // menu before the name is inserted.
    selectOnPress: true,
    subtitle: true,
  },
  // Task timeline: a compact bordered list with an arrow-key cursor.
  timeline: {
    list: 'rounded-[10px] border border-faint bg-white p-1 max-h-[160px] overflow-y-auto',
    row: 'flex w-full items-center gap-2 rounded-[7px] px-3 py-2 text-left text-[13px] font-medium',
    idle: 'text-muted hover:bg-canvas',
    selected: 'bg-canvas text-ink',
    avatar: 'chat-inline',
    selectOnPress: false,
    subtitle: false,
  },
};

/**
 * The list that opens over a composer when you type `@`. It draws and
 * highlights; the keyboard belongs to the composer, which owns `selectedIndex`.
 *
 * @param {object[]} props.members Candidates, already filtered by what was typed.
 * @param {'composer'|string} props.density Row height and whether the email is shown.
 * @param {number} props.selectedIndex Which row the arrow keys have landed on; -1 for none.
 * @param {(member) => void} props.onSelect Fires with the chosen member.
 * @param {string} props.className Placement in the parent only.
 */
export default function MentionMenu({
  members = [],
  density = 'composer',
  selectedIndex = -1,
  onSelect,
  className = '',
}) {
  const config = DENSITIES[density] ?? DENSITIES.composer;
  if (members.length === 0) return null;

  return (
    <div className={`${config.list} ${className}`}>
      {members.map((member, index) => {
        const key = member.id || member.uid;
        const name = member.name || member.email;
        const press = config.selectOnPress
          ? { onMouseDown: event => { event.preventDefault(); onSelect?.(member); } }
          : { onClick: () => onSelect?.(member) };

        return (
          <button
            key={key}
            type="button"
            {...press}
            className={`${config.row} ${index === selectedIndex ? config.selected : config.idle}`}
          >
            <UserAvatar user={config.subtitle ? { name: member.name, avatar: member.avatar } : member} size={config.avatar} />
            {config.subtitle ? (
              <div>
                <p className="text-[13px] font-semibold text-ink">{name}</p>
                {member.email && member.name && <p className="text-[11px] text-muted">{member.email}</p>}
              </div>
            ) : (
              <span>{member.name}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
