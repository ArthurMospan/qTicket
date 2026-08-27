'use client';

// ─── UI Kit: Load Older ──────────────────────────────────────────────────────
// The control at the top of a windowed history.
//
// Neither the chat nor the task timeline subscribes to a whole conversation —
// a channel discussed for a year, or a task touched four hundred times, would
// otherwise cost its entire history every time somebody opened it. Both show
// the newest page and both need the same way past it, so it is one control
// rather than two that happen to look alike.

/**
 * The control at the top of a windowed history, which loads the page before it.
 *
 * @param {() => void} props.onClick Widens the window.
 * @param {string} props.children What lies further back, in words.
 */
export default function LoadOlderButton({ onClick, children = 'Показати давніші повідомлення' }) {
  return (
    <div className="flex justify-center pb-2 pt-1">
      <button
        type="button"
        onClick={onClick}
        className="rounded-full bg-canvas px-3 py-1 text-[12px] font-semibold text-muted transition-colors hover:bg-line hover:text-ink"
      >
        {children}
      </button>
    </div>
  );
}
