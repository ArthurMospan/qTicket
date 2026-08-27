'use client';

import React from 'react';
import { Hash } from 'lucide-react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import PresenceDot from '@/components/ui/DataDisplay/PresenceDot';
import Counter from '@/components/ui/DataDisplay/Counter';

// The chat rail: grouped channels and direct messages.
//
// This markup used to live inline in /chat, and /ui-kit showed a hand-copied
// approximation of it beside the real thing. The copy drifted immediately —
// wrong radius, wrong active colour, missing unread counters — which is the
// exact failure the catalogue exists to prevent. There is no copy now: the page
// and the preview render this component, so they cannot disagree.
/**
 * The chat rail: grouped channels and direct messages, with unread counters.
 *
 * @param {{id: string, title: string, items: object[]}[]} props.groups The sections and their conversations.
 * @param {string} props.activeId Id of the open conversation.
 * @param {(id: string) => void} props.onSelect Opens one.
 */
export default function ChannelRail({ groups = [], activeId, onSelect = () => {} }) {
  // `RAIL_INSET`'s 32px of air above the first group is what makes a rail read
  // as a rail beside a pane. On a phone the rail *is* the screen, and that air
  // is four channels' worth of nothing above the first one you came to open.
  return (
    <aside className="qt-nav-scroll flex-1 overflow-y-auto custom-scrollbar px-[16px] py-[32px] max-md:px-[10px] max-md:pt-[12px] max-md:pb-[8px]">
      {groups.map((group, index) => (
        <div key={group.id} className={index < groups.length - 1 ? 'mb-[24px]' : undefined}>
          <div className="flex items-center justify-between px-3 pb-[8px] group">
            <span className="text-[10px] font-bold text-muted uppercase tracking-widest">
              {group.label}
            </span>
            {group.action}
          </div>

          <div className="flex flex-col gap-[2px]">
            {group.items.map(item => {
              const active = item.id === activeId;
              const hasUnread = item.unreadCount > 0 && !active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item)}
                  data-ui-control="chat-list-action"
                  className={`ui-native-control ${
                    active
                      ? 'bg-line text-ink font-semibold'
                      : 'text-muted hover:bg-line/50 hover:text-ink'
                  }`}
                >
                  {item.kind === 'dm' ? (
                    <div className="relative shrink-0">
                      <div className="w-[18px] h-[18px] rounded-full overflow-hidden">
                        <UserAvatar user={item.user || item} size="chat-mention" />
                      </div>
                      {item.online && <PresenceDot size="xs" collar="canvas" />}
                    </div>
                  ) : (
                    <Hash size={14} className={active ? 'text-ink' : 'text-muted'} />
                  )}

                  <span
                    className={`text-[13px] max-md:text-[14px] flex-1 truncate flex items-center gap-1 ${
                      hasUnread ? 'font-bold text-ink' : ''
                    }`}
                  >
                    {item.name}
                    {item.statusEmoji && (
                      <span className="cursor-help" title={item.statusText || 'Статус користувача'}>
                        {item.statusEmoji}
                      </span>
                    )}
                  </span>

                  {hasUnread && (
                    <Counter value={item.unreadCount} size="sm" status="muted" className="shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}
