'use client';

// The line a person writes about themselves — «🌴 Вихідний», «💻 Весь в роботі».
//
// It is one dialog, not two. Setting a status used to be reachable from exactly
// one place, the pill in the chat header, while the place it is actually *read*
// — the bubble over the avatar on a profile — was not a control at all. So the
// picker lives here and both of them open it; the pill and the bubble are the
// two triggers, and neither owns the writing.

import { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { Button, Dialog, Input } from '@/components/ui';

const STATUS_PRESETS = [
  { emoji: '💻', text: 'Весь в роботі' },
  { emoji: '🔴', text: 'Зайнятий' },
  { emoji: '🚗', text: 'В дорозі' },
  { emoji: '🔥', text: 'Овертаймлю' },
  { emoji: '🌴', text: 'Вихідний' },
  { emoji: '🧠', text: 'Думаю...' },
  { emoji: '📞', text: 'На зв\'язку' },
];

const EMOJIS = ['😊', '😇', '🤔', '😎', '😴', '🤯', '🥳', '👋', '🤝', '🙌', '✨', '🏆', '🎨', '🚀'];

export const DEFAULT_STATUS_EMOJI = '💭';

/**
 * The status picker. Mounted by whatever is showing the status, and only while
 * it is open — the fields start from what is set now, which a component that
 * stays mounted between openings would have to be told to re-read.
 *
 * @param {() => void} props.onClose Dismisses it.
 */
export default function UserStatusDialog({ onClose }) {
  const { currentUser } = useAppContext();
  const [text, setText] = useState(() => currentUser?.status || '');
  const [emoji, setEmoji] = useState(() => currentUser?.statusEmoji || DEFAULT_STATUS_EMOJI);

  const handleUpdate = async (newEmoji, newText) => {
    if (!currentUser?.id) return;
    try {
      // UI оновиться через live-підписку useAuth на users/{uid} — мутувати
      // currentUser не можна
      await updateDoc(doc(db, 'users', currentUser.id), {
        status: newText,
        statusEmoji: newEmoji,
      });
      useWorkspaceStore.getState().showToast('Статус оновлено', 'success');
      onClose();
    } catch (err) {
      console.error(err);
      useWorkspaceStore.getState().showToast('Помилка оновлення статусу', 'error');
    }
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Ваш статус"
      titleContext="eyebrow"
      presentation="dialog"
      size="status"
      bodyPadding="spacious"
      headerAction={(currentUser?.status || currentUser?.statusEmoji) ? (
        <Button style="ghost" color="red" size="sm" onClick={() => handleUpdate('', '')}>
          Очистити
        </Button>
      ) : null}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-[8px]">
          {STATUS_PRESETS.map((p, i) => (
            <button
              key={i}
              onClick={() => handleUpdate(p.emoji, p.text)}
              className="flex items-center gap-[10px] p-[10px] rounded-[12px] hover:bg-canvas transition-all text-left group"
            >
              <span className="text-[20px] group-hover:scale-110 transition-transform">{p.emoji}</span>
              <span className="text-[12px] font-bold text-ink truncate">{p.text}</span>
            </button>
          ))}
        </div>

        <div className="h-[1px] bg-canvas" />

        <div className="flex flex-col gap-[16px]">
          <div className="grid grid-cols-7 gap-[8px]">
            {EMOJIS.map(e => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={`w-[36px] h-[36px] rounded-full flex items-center justify-center text-[18px] transition-all ${emoji === e ? 'bg-canvas scale-110 shadow-sm' : 'hover:bg-canvas'}`}
              >
                {e}
              </button>
            ))}
          </div>
          <div className="flex gap-[8px]">
            <Input
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Що на думці?"
              maxLength={35}
              composition="status-entry"
              onKeyDown={(e) => e.key === 'Enter' && handleUpdate(emoji, text)}
            />
            <Button
              onClick={() => handleUpdate(emoji, text)}
              composition="status-submit"
            >
              OK
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
