'use client';

import { CloudOff } from 'lucide-react';

// ─── UI Kit: ConnectionBanner ────────────────────────────────────────────────
// The one place the app admits it is offline.
//
// Some direct Firestore writes may wait for a connection, but status changes,
// comments and other authenticated server requests cannot. A workspace-wide
// banner therefore never promises a queue the product does not own.

/**
 * A persistent strip shown while the browser reports no connection.
 *
 * @param {boolean} props.offline Whether to show it.
 * @param {string} props.message What it says.
 */
export default function ConnectionBanner({
  offline,
  message = 'Немає звʼязку — зміни зараз не зберігаються.',
}) {
  return (
    <div
      // Always in the tree, so the reader is told the moment it changes rather
      // than only if it happens to change while something else re-renders.
      role="status"
      aria-live="polite"
      aria-hidden={!offline}
      className={`print:hidden fixed left-1/2 top-[12px] z-[60] flex -translate-x-1/2 items-center gap-[8px] rounded-[12px] border border-warning-solid/50 bg-warning-soft px-[14px] py-[8px] shadow-[0_6px_20px_-6px_rgba(0,0,0,0.25)] transition-all duration-200 ${
        offline ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-[140%] opacity-0'
      }`}
    >
      <CloudOff size={15} className="shrink-0 text-warning" />
      <span className="text-[12px] font-semibold text-warning">{message}</span>
    </div>
  );
}
