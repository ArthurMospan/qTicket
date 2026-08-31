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
 * @param {string} props.label Human-readable boundary label.
 * @param {string} props.className Placement in the parent only.
 */
export default function UnreadDivider({
  label = 'Нові повідомлення',
  className = '',
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      className={`flex w-full items-center gap-2.5 py-1 ${className}`}
    >
      <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-ink/15" />
      <span className="inline-flex shrink-0 items-center rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-ink shadow-sm ring-1 ring-black/[0.05]">
        {label}
      </span>
      <span aria-hidden="true" className="h-px min-w-0 flex-1 bg-ink/15" />
    </div>
  );
}
