'use client';
import { useEffect, useState } from 'react';

/**
 * Якщо на екрані видно лише 500 символів, навіщо тягнути весь файл? Бо
 * fetch тут — не Range-запит: сервер (Cloudinary) віддає повне тіло, і
 * лише після цього ми ріжемо рядок локально. Для мініатюри це прийнятно;
 * для файлів у десятки мегабайтів — можливе майбутнє покращення через
 * заголовок Range, щоб не качати зайве.
 */
export default function TextThumb({ url, onFailed }) {
  const [content, setContent] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!canceled) setContent(text.slice(0, 500));
      } catch {
        if (!canceled) { setFailed(true); onFailed?.(); }
      }
    })();
    return () => { canceled = true; };
  }, [url, onFailed]);

  if (failed) return null;
  if (content === null) {
    return (
      <div className="w-full h-[160px] bg-canvas flex items-center justify-center">
        <div className="w-4 h-4 border-2 border-line border-t-muted rounded-full animate-spin" />
      </div>
    );
  }
  return (
    <div className="w-full h-[160px] bg-ink p-3 overflow-hidden relative select-none">
      <pre className="text-[9px] text-white/60 font-mono leading-tight whitespace-pre-wrap break-all">{content}</pre>
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-transparent" />
    </div>
  );
}
