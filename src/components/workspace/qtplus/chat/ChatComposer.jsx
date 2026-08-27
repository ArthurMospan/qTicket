'use client';
import { useEffect, useRef, useState } from 'react';
import ChatComposerDock from '@/components/ui/ChatComposerDock';
import ChatComposerCore from '@/components/ui/ChatComposerCore';

const TYPING_IDLE_MS = 3000;

/**
 * Поле вводу чату. Enter — надіслати (Shift+Enter — новий рядок).
 * Керує typing: setTyping(true) на початку набору, setTyping(false) після
 * паузи або надсилання. onSend/onTyping приходять від панелі.
 */
export default function ChatComposer({ onSend, onTyping, disabled, scrollRef }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const typingRef = useRef(false);
  const idleTimer = useRef(null);

  const stopTyping = () => {
    if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    if (typingRef.current) { typingRef.current = false; onTyping?.(false); }
  };

  // Знімаємо typing, якщо компонент зникає (зміна проєкту / розмонтування).
  useEffect(() => stopTyping, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (e) => {
    setText(e.target.value);
    if (disabled) return;
    if (!typingRef.current && e.target.value.trim()) {
      typingRef.current = true;
      onTyping?.(true);
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stopTyping, TYPING_IDLE_MS);
  };

  const submit = async () => {
    const body = text.trim();
    if (!body || sendingRef.current || disabled) return;
    sendingRef.current = true;
    setSending(true);
    stopTyping();
    try {
      await onSend(body);
      setText('');
    } catch (e) {
      console.error('[qtplus] send failed:', e?.message);
    }
    sendingRef.current = false;
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <ChatComposerDock scrollRef={scrollRef} composition="timeline-composer">
      <ChatComposerCore
        variant="qtplus"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={stopTyping}
        disabled={disabled}
        placeholder={disabled ? 'Немає доступу' : 'Повідомлення…'}
        onSubmit={submit}
        canSubmit={Boolean(text.trim())}
        sending={sending}
      />
    </ChatComposerDock>
  );
}
