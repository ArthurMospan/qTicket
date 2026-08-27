'use client';

import React from 'react';
import { plural } from '@/lib/utils/plural.mjs';

// ─── UI Kit: Chat Search Banner ──────────────────────────────────────────────
// The amber strip that says how many messages matched, with the way to drop the
// filter.
//
// Its «Очистити» was the only amber text button in the product. Rather than
// give the shared `TextAction` a one-off amber tone that nothing else would
// ever ask for, the colour stays here, where it belongs to the banner it sits
// on — a tone with one caller is a hardcode wearing a variant's name.
/**
 * The amber strip above a filtered conversation: how many messages matched, and
 * the way to drop the filter.
 *
 * @param {string} props.query What was searched for.
 * @param {number} props.count How many messages matched; the wording declines with it.
 * @param {() => void} props.onClear Drops the filter.
 */
export default function ChatSearchBanner({ query, count = 0, onClear }) {
  return (
    <div className="bg-warning-soft border-b border-warning-solid/40 px-6 py-2 flex items-center justify-between shrink-0">
      <p className="text-[13px] text-warning">
        Знайдено <strong>{count}</strong> {plural(count, ['повідомлення', 'повідомлення', 'повідомлень'])} за запитом <strong>«{query}»</strong>
      </p>
      <button
        type="button"
        onClick={onClear}
        className="text-warning hover:text-ink text-[13px] font-semibold underline"
      >
        Очистити
      </button>
    </div>
  );
}
