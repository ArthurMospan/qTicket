'use client';
import { useState } from 'react';
import { Trash2, Check, CheckCheck } from 'lucide-react';
import TextAction from '@/components/ui/TextAction';
import { formatMsgTime } from '@/lib/portal/qtplusChatView.mjs';

function ChatAuthorAvatar({ name, url, size = 32 }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const box = { width: size, height: size };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- avatars come from arbitrary identity providers, which next/image cannot whitelist
    return <img src={url} alt="" style={box} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <div
      style={{ ...box, fontSize: size <= 20 ? 9 : 11 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-white font-semibold text-muted"
    >
      {initial}
    </div>
  );
}

/**
 * Одне повідомлення чату. `view` — з toChatMessageView.
 * Системні повідомлення — центрований рядок. Свої — праворуч, з можливістю видалити.
 */
export default function ChatMessage({ view, othersCount, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  if (view.system) {
    const time = formatMsgTime(view.createdAtMs);
    return (
      <div className="flex justify-center px-3 py-1">
        {/* Той самий рядок, що й у чаті завдання: час — інлайн у кінці речення,
            а не окрема колонка, яка зависає збоку від тексту в три рядки. */}
        <div data-ui-surface="system-message" className="ui-surface flex max-w-[92%] items-start gap-2">
          <span className="mt-[1px] shrink-0">
            <ChatAuthorAvatar name={view.senderName} url={view.avatarUrl} size={18} />
          </span>
          <p className="min-w-0 text-[11px] leading-[18px] text-muted">
            {view.senderId && <strong className="font-semibold text-ink">{view.senderName}</strong>}
            {view.senderId && ' '}
            {view.text}
            {time && <span className="ml-1.5 whitespace-nowrap text-[10px] text-faint">{time}</span>}
          </p>
        </div>
      </div>
    );
  }

  const time = formatMsgTime(view.createdAtMs);
  // Прочитано всіма іншими учасниками, якщо в readBy є хтось окрім мене.
  const readByOthers = view.readBy.filter((id) => id !== view.senderId).length > 0;

  if (view.mine) {
    return (
      <div className="group flex flex-row-reverse gap-3">
        <div className="flex max-w-[85%] min-w-0 flex-col items-end">
          <div className="rounded-[16px] rounded-br-none bg-ink-hover p-3 text-white">
            <p className="whitespace-pre-wrap break-words text-[14px] leading-[22px]">{view.text}</p>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            {time && <span className="text-[10px] font-medium text-faint">{time}</span>}
            {readByOthers
              ? <CheckCheck size={12} className="text-muted" />
              : <Check size={12} className="text-faint" />}
            {onDelete && (
              confirming ? (
                <TextAction tone="danger" size="xs" onClick={() => onDelete(view.id)}>
                  Видалити?
                </TextAction>
              ) : (
                <TextAction
                  tone="danger-quiet"
                  size="xs"
                  icon={Trash2}
                  label="Видалити повідомлення"
                  onClick={() => setConfirming(true)}
                  onBlur={() => setConfirming(false)}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                />
              )
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-3">
      <div className="mb-5"><ChatAuthorAvatar name={view.senderName} url={view.avatarUrl} /></div>
      <div className="flex max-w-[85%] min-w-0 flex-col items-start">
        {othersCount > 1 && <span className="mb-1 ml-1 text-[11px] font-bold text-ink">{view.senderName}</span>}
        <div data-ui-surface="local" className="rounded-[16px] rounded-bl-none bg-white p-3 text-ink">
          <p className="whitespace-pre-wrap break-words text-[14px] leading-[22px]">{view.text}</p>
        </div>
        {time && <span className="mt-1 pl-1 text-[10px] font-medium text-faint">{time}</span>}
      </div>
    </div>
  );
}
