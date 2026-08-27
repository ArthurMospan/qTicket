'use client';

// The status pill in the chat header: what you are up to, and the way to change
// it. The picker itself is `UserStatusDialog`, because the bubble over an
// avatar on «Команда» opens the same one.

import { useState } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import UserStatusDialog from '@/components/UserStatusDialog';

export default function UserStatusSetter() {
  const { currentUser } = useAppContext();
  const [isEditing, setIsEditing] = useState(false);

  return (
    <>
      <button
        onClick={() => setIsEditing(true)}
        className="flex items-center gap-1.5 mr-1 bg-canvas px-3 py-1.5 rounded-full cursor-pointer hover:bg-line transition-colors"
      >
        {currentUser?.status || currentUser?.statusEmoji ? (
          <>
            {currentUser.statusEmoji && <span className="text-[12px]">{currentUser.statusEmoji}</span>}
            {currentUser.status && <span className="text-[11px] font-bold text-ink max-w-[120px] truncate">{currentUser.status}</span>}
          </>
        ) : (
          <span className="text-[11px] font-bold text-muted">Встановити статус</span>
        )}
      </button>

      {isEditing && <UserStatusDialog onClose={() => setIsEditing(false)} />}
    </>
  );
}
