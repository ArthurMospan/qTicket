'use client';

/**
 * The boundary between previously seen chat history and unread messages.
 *
 * It carries no number, on purpose. A count here has to be frozen — the line
 * stays where the visit found it while the conversation keeps moving — so it
 * went stale the moment anybody wrote anything: «Нові повідомлення (2)» with
 * four messages under it, two of them the reader's own. Telegram and Slack draw
 * this line without a number for the same reason. The live count belongs to the
 * jump control and the chat tab, which are free to change.
 *
 * Given `onDismiss`, the pill is a real button and the line can be taken down
 * by pressing it. That way back existed once as a hover and was removed for a
 * good reason — a phone has no pointer to hover with, so the line was permanent
 * for a whole visit there — and the replacement was «sending a message takes it
 * down», which is true but is not something a reader who only wanted to read
 * can do. A press works on both, is deliberate, and is what Discord puts on the
 * same bar. The line still survives until then: it is a landmark saying where
 * you stopped, not a notice that clears itself the moment your eye crosses it.
 *
 * @param {string} props.label Human-readable boundary label.
 * @param {() => void} props.onDismiss Takes the line down. Without it the pill is not a control.
 * @param {string} props.className Placement in the parent only.
 */
export default function UnreadDivider({
  label = 'Нові повідомлення',
  onDismiss,
  className = '',
}) {
  const pill = (
    <span className="inline-flex shrink-0 items-center rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-ink shadow-sm ring-1 ring-black/[0.05]">
      {label}
    </span>
  );
  return (
    <div
      role="separator"
      aria-label={label}
      className={`flex w-full items-center gap-2.5 py-1 ${className}`}
    >
      <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-ink/15" />
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          title="Прибрати позначку"
          aria-label={`${label} — прибрати позначку`}
          className="shrink-0 transition-opacity hover:opacity-70"
        >
          {pill}
        </button>
      ) : pill}
      <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-ink/15" />
    </div>
  );
}
