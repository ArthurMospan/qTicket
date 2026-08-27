'use client';

import React from 'react';
import { Bell } from 'lucide-react';
import Counter from '@/components/ui/DataDisplay/Counter';

/**
 * The bell in the workspace header: how many notifications are unread, and
 * whether one of them is an emergency — which replaces the glyph outright,
 * because an emergency is not a louder version of the same thing.
 *
 * Moved out of `WorkspaceHeader` with its classes intact. The header is a smart
 * component and cannot live in the kit; the bell is a button with a badge.
 *
 * @param {number} props.unreadCount How many are unread. Over nine reads as `9+`; zero draws no badge.
 * @param {boolean} props.hasEmergency An emergency is waiting, so the bell becomes 🔥 and the count is not drawn over it.
 * @param {boolean} props.open Whether the notification centre is showing — this is the pressed look.
 * @param {() => void} props.onToggle Opens and closes it.
 * @param {string} props.panelId Id of the panel it controls, announced while that panel is open.
 */
export default function NotificationBell({
  unreadCount = 0,
  hasEmergency = false,
  open = false,
  onToggle,
  panelId = 'notification-center-panel',
}) {
  return (
    <button
      id="notif-bell"
      type="button"
      aria-label="Сповіщення"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={onToggle}
      className={`relative w-[36px] h-[36px] flex items-center justify-center rounded-[10px] transition-all ${
        open ? 'bg-canvas text-ink' : 'text-muted hover:bg-canvas hover:text-ink'
      } ${unreadCount > 0 ? 'animate-[bellShake_0.4s_ease]' : ''}`}
    >
      {hasEmergency ? <span className="animate-bounce text-[16px]">🔥</span> : <Bell size={18} />}
      {unreadCount > 0 && !hasEmergency && (
        <Counter value={unreadCount > 9 ? '9+' : unreadCount} size="xs" className="absolute right-[6px] top-[6px]" />
      )}
    </button>
  );
}
