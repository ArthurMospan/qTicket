'use client';

import React from 'react';
import { X } from 'lucide-react';

/**
 * One notification, drawn as the card that slides in over the workspace when it
 * arrives: who did it, what happened, and the two things you can do about it.
 *
 * Not a `Toast`. A toast reports that something you just did worked and takes
 * itself away; this arrives unasked, names a sender, and can carry a whole
 * calendar reply inside it. The icon and those extra actions are slots rather
 * than props, because deciding which glyph a notification type gets is the
 * product's business, not the kit's.
 *
 * The card does not place itself. It used to pin its own corner, which meant
 * two of them arriving together sat on top of each other — so the corner is the
 * business of the layer that stacks them, and this is a card of a fixed width
 * wherever it is put.
 *
 * It used to open with two lines that could not tell the reader anything: a
 * capitalised category that repeated the title in worse words, and the name of
 * the organisation — which is filtered three times over on the way here and is
 * therefore always the one already written in the header. So the card's first
 * line is now the only thing it arrived to say: who, and what.
 *
 * The card is the control. It carried a small «Перейти» link instead, which
 * made a 320px card with one destination hold a 60px target for it — and the
 * row this same notification gets in the bell had been fully clickable the
 * whole time, so the same thing behaved two ways depending on where you saw it.
 * `openLabel` still names the destination, but it names it to a screen reader
 * now rather than occupying a line: the card says who and what, and going there
 * is what clicking it does.
 *
 * @param {React.ReactNode} props.icon The sender's face, drawn at the leading edge.
 * @param {string} props.title What happened.
 * @param {string} props.body The detail under it, clamped to two lines.
 * @param {string} props.time How long ago, since the card can sit there while nobody is at the desk.
 * @param {'emergency'|'default'} props.tone An emergency draws a different surface.
 * @param {React.ReactNode} props.actions Extra controls inside the card — the calendar reply buttons.
 * @param {string} props.openLabel Where the card goes, in words — it becomes the
 *   card's accessible name after the title, not a second control.
 * @param {() => void} props.onOpen Goes to whatever the notification is about. Without it the card is not a control.
 * @param {() => void} props.onDismiss Hides the card.
 * @param {React.CSSProperties} props.style Animation and stacking, which the layer above owns.
 */
export default function NotificationCard({
  icon,
  title,
  body,
  time,
  tone = 'default',
  actions,
  openLabel = 'Перейти',
  onOpen,
  onDismiss,
  style,
}) {
  return (
    <div
      data-qt-global-notification-layer
      data-ui-surface="notification"
      data-ui-tone={tone}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? [title, openLabel].filter(Boolean).join(' — ') : undefined}
      onClick={onOpen}
      onKeyDown={onOpen ? (event => {
        // The dismiss × and the calendar replies are inside the card and are
        // real buttons; a space on one of those is that button's, not the
        // card's.
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onOpen();
      }) : undefined}
      className={`ui-surface w-[min(320px,calc(100vw-24px))] overflow-hidden${onOpen ? ' cursor-pointer transition-colors hover:bg-canvas' : ''}`}
      style={style}
    >
      <div className="flex items-start gap-3 px-4 py-4">
        {icon}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-bold text-ink leading-snug">{title}</p>
          {body && <p className="text-[11px] text-muted mt-1 line-clamp-2">{body}</p>}
          {actions && <div onClick={event => event.stopPropagation()}>{actions}</div>}
          {time && <p className="mt-2 text-[10px] text-faint">{time}</p>}
        </div>
        <button
          onClick={event => { event.stopPropagation(); onDismiss?.(); }}
          aria-label="Приховати сповіщення"
          className="text-faint hover:text-ink transition-colors p-1"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
