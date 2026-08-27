'use client';
import { useEffect, useMemo, useRef } from 'react';
import { ChatIcon } from '@/lib/design/icons';
import { usePortalChat } from '@/lib/portal/usePortalChat';
import { toChatMessageView, dayLabel, unreadCount } from '@/lib/portal/qtplusChatView.mjs';
import ChatMessage from './ChatMessage';
import ChatComposer from './ChatComposer';
import EmptyState from '@/components/ui/Feedback/EmptyState';
import { Counter, Pill } from '@/components/ui';

function Spinner() {
  return <div className="w-4 h-4 border-2 border-line border-t-ink rounded-full animate-spin" />;
}

function DayDivider({ label }) {
  return (
    <div className="flex items-center justify-center py-3">
      <Pill tone="surface" size="chat-day-wide" uppercase>{label}</Pill>
    </div>
  );
}

/**
 * Панель чату проєкту QuickTeam+ (Фаза 4b). Монтується поряд з етапами у вкладці.
 * portalUser + currentUser приходять від QtPlusProjectTab; qtProjectId — id проєкту
 * в ПОРТАЛІ (link.projectId). Панель read+write у портальну БД (див. usePortalChat).
 */
// embedded: режим для вбудовування в чужий контейнер (таб чату в завданні) —
// без власної рамки/заголовка, на всю висоту батька.
export default function QtPlusChatPanel({ qtProjectId, portalUser, currentUser, embedded = false }) {
  const uid = portalUser?.uid || null;
  const { messages, loading, error, typingUsers, sendMessage, setTyping, markAllRead, deleteMessage } =
    usePortalChat(qtProjectId, portalUser);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);

  const views = useMemo(() => messages.map((m) => toChatMessageView(m, uid)), [messages, uid]);

  // Скільки різних співрозмовників (окрім мене) — щоб показувати імена лише у груповому чаті.
  const othersCount = useMemo(() => {
    const ids = new Set();
    views.forEach((v) => { if (!v.system && v.senderId && !v.mine) ids.add(v.senderId); });
    return ids.size + 1; // + я
  }, [views]);

  const unread = unreadCount(messages, uid);

  // Автоскрол донизу на нові повідомлення (тільки якщо користувач уже внизу).
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom || (views.length && views[views.length - 1].mine)) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [views]);

  // Позначаємо чужі непрочитані прочитаними, коли вони приходять і панель відкрита.
  useEffect(() => {
    if (!messages.length) return;
    markAllRead(messages);
  }, [messages, markAllRead]);

  const displayName = currentUser?.name || 'Учасник';
  const avatarUrl = currentUser?.avatar || null;

  return (
    <div className={embedded
      ? 'flex flex-col h-full min-h-0 bg-canvas overflow-hidden'
      : 'flex flex-col h-[520px] max-h-[70vh] rounded-[16px] bg-canvas overflow-hidden'}>
      {!embedded && (
        <div className="relative z-10 flex shrink-0 items-center gap-2 bg-canvas/90 px-3 py-2 backdrop-blur-xl">
          <ChatIcon size={15} className="text-muted" />
          <span className="text-[13px] text-ink font-semibold">Чат</span>
          {unread > 0 && (
            <Counter value={unread} size="md" className="ml-auto" />
          )}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-3 flex flex-col gap-4">
        {loading ? (
          <div className="flex-1 flex items-center justify-center"><Spinner /></div>
        ) : error ? (
          <p className="text-[12px] text-muted m-auto text-center">
            {error === 'no_access'
              ? 'Немає доступу до чату цього проєкту.'
              : 'Не вдалося завантажити чат. Спробуйте пізніше.'}
          </p>
        ) : views.length === 0 ? (
          <EmptyState
            icon={ChatIcon}
            title="Ще немає повідомлень"
            description="Напишіть перше повідомлення."
            context="centered"
            density="compact"
          />
        ) : (
          views.map((v, i) => {
            const prev = views[i - 1];
            const label = dayLabel(v.createdAtMs);
            const showDay = label && (!prev || dayLabel(prev.createdAtMs) !== label);
            return (
              <div key={v.id || i} className="flex flex-col gap-4">
                {showDay && <DayDivider label={label} />}
                <ChatMessage view={v} othersCount={othersCount} onDelete={v.mine ? deleteMessage : null} />
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {typingUsers.length > 0 && (
        <div className="px-3 py-1 text-[11px] text-muted shrink-0">
          {typingUsers.length === 1 ? `${typingUsers[0].name} пише…` : 'Кілька людей пишуть…'}
        </div>
      )}

      <ChatComposer
        scrollRef={scrollRef}
        disabled={Boolean(error)}
        onSend={(text) => sendMessage(text, displayName, avatarUrl)}
        onTyping={(isTyping) => setTyping(isTyping, displayName)}
      />
    </div>
  );
}
