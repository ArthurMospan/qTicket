// src/app/not-found.js — the 404 screen.
//
// There was none, so an address that matched no route fell through to the
// framework's unstyled default: black Helvetica on white, in English, with no
// way back into the workspace. Rare is not the same as never — a stale link in
// Telegram, a renamed project, a typed URL — and the one time someone lands
// here it should look like the product they were trying to reach.

import Link from 'next/link';

export const metadata = {
  title: 'Сторінку не знайдено',
};

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-canvas p-6">
      <div
        data-ui-surface="local"
        className="w-full max-w-[420px] rounded-[16px] border border-line bg-white p-8 text-center shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
      >
        <p className="ui-type-display-title text-faint">404</p>
        <h1 className="ui-type-detail-title text-ink mt-2 mb-2">Сторінку не знайдено</h1>
        <p className="text-[13px] text-muted mb-6">
          Можливо, посилання застаріло, або проєкт чи завдання видалили.
        </p>
        <Link
          href="/"
          className="inline-flex h-[36px] items-center rounded-[10px] bg-ink px-[18px] text-[14px] font-bold text-white transition-colors hover:bg-ink-hover"
        >
          На головну
        </Link>
      </div>
    </div>
  );
}
