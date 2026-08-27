'use client';

import React from 'react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';

/**
 * The avatar in the workspace header and the menu it opens: who you are signed
 * in as, and the two things you can do about it.
 *
 * Moved out of `WorkspaceHeader` with its classes intact. The header is a smart
 * component — context, store, router, Firestore — so it cannot live in the kit;
 * this part of it is nothing but markup and callbacks, and the audit counted
 * its three controls as hand-written UI for exactly that reason.
 *
 * @param {object} props.user The signed-in user: the avatar, the name and the email come from this.
 * @param {boolean} props.open Whether the menu is showing. The header owns the state, because the bell has to close it.
 * @param {() => void} props.onToggle Opens and closes the menu.
 * @param {() => void} props.onSettings Goes to settings.
 * @param {() => void} props.onSignOut Signs out.
 */
export default function UserMenu({ user, open = false, onToggle, onSettings, onSignOut }) {
  return (
    <div className="relative">
      <button
        data-ui-action="avatar-menu"
        aria-label="Меню користувача"
        aria-expanded={open}
        onClick={onToggle}
        className="flex items-center justify-center w-[36px] h-[36px] rounded-[10px] hover:bg-canvas transition-all overflow-hidden"
      >
        <UserAvatar user={user} size="sm" />
      </button>
      {open && (
        <div data-ui-surface="local" className="absolute right-0 top-[calc(100%+8px)] w-[200px] bg-white border border-line rounded-[16px] shadow-[0_8px_40px_rgba(0,0,0,0.10)] overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-canvas">
            <p className="text-[13px] font-bold text-ink truncate">{user?.name}</p>
            <p className="text-[11px] text-muted truncate">{user?.email}</p>
          </div>
          <button
            onClick={onSettings}
            className="flex w-full px-4 py-[10px] text-[13px] text-ink hover:bg-canvas transition-colors font-medium"
          >
            Налаштування
          </button>
          <div className="border-t border-canvas">
            <button
              onClick={onSignOut}
              className="flex w-full px-4 py-[10px] text-[13px] text-danger hover:bg-danger-soft transition-colors font-medium"
            >
              Вийти
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
