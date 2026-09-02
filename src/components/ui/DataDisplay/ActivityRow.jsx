'use client';

import React from 'react';
import Link from 'next/link';
import { LifeBuoy } from 'lucide-react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';

// ─── UI Kit: Activity Row ────────────────────────────────────────────────────
// One line of «що сталося»: who, what, to which request, when.
//
// There were two of these. The project card on «Проєкти» has drawn a compact
// grey row — small face, one truncated sentence, the key and title in ink, the
// time in a 10px chip at the end — since long before this component existed,
// and «Огляд» drew the same event as a 12px-padded white tile with a bordered
// edge, a 28px face and the time in a `Pill`. Same sentence, same data, same
// question, two lists that looked like two products. The owner asked for the
// card's version, and the card's version is also the smaller one: a feed is
// read by scanning down the left edge, and a tile with its own border and its
// own ring stops the eye at every row.
//
// So this is that row, and the card uses it too — a repeated visual pattern
// lives in the kit, and two implementations of one shape is exactly how they
// drifted the first time.
//
// What did not come across from the card is its ink. The sentence there is
// `muted` (#9a9a9a) on `canvas` (#f4f4f5) — about 2.5:1, below AA for body
// text — and this row already had that fixed once: on «Огляд» the sentence is
// the thing a customer opened the screen to read, and the message under it was
// `faint` at 1.7:1. Both stay on `ink-soft`. The two proper nouns of the
// sentence — who acted and which request — keep full `ink`, which is the only
// weight that has to carry down a column.
//
// Not `TaskRow` with different content. A task row is about a record — its
// status, its priority, its people — and is read down a column by comparing
// those. This is about an *event*, read newest-first, and the request it
// happened to is the object of the sentence rather than the subject of the row.
//
// The face is optional and its absence is meaningful rather than a fallback: a
// customer is never told which agent acted, so their feed carries sentences with
// no subject and must not draw a placeholder circle where a person would be.
// `UserAvatar` given a nameless user draws exactly that circle, which is why
// this decides rather than passing an empty object down.

/**
 * One line of an activity feed: who did what, to which request, and when.
 *
 * @param {object} props.actor Who did it — omitted where the reader may not know.
 * @param {boolean} props.fromSupport The desk did it, and the reader is not told which agent. Draws a mark rather than a face, so the line keeps the weight of a named one.
 * @param {string} props.actorName Their name, drawn in ink before the verb.
 * @param {string} props.text What they did, or what happened, as a full clause when there is no actor.
 * @param {string} props.detail The message itself, where the event was one. Clamped to one line.
 * @param {string} props.issueKey Short key of the request, e.g. ACME-12.
 * @param {string} props.title The request's own title.
 * @param {string} props.time Already formatted — the row does no date logic.
 * @param {string} props.href Where the row goes, as a real link: a feed row is a
 *   destination, and a `<button>` cannot be middle-clicked into a new tab. Given
 *   one, the row is an anchor; given only `onClick`, it stays a button.
 * @param {() => void} props.onClick Opens the request, or rides along with `href` where the row sits inside another clickable card.
 * @param {string} props.className Placement in the parent only.
 */
export default function ActivityRow({
  actor = null,
  fromSupport = false,
  actorName = '',
  text,
  detail = '',
  issueKey = '',
  title = '',
  time = '',
  href = '',
  onClick,
  className = '',
}) {
  // The hover fill is `line`, not a lighter `canvas`: a row already sitting on
  // `canvas` that hovers to `canvas` is a hover you cannot see — the two ends
  // of the transition are four points apart on a 255-point scale.
  const rowClass = [
    'group flex w-full gap-[8px] rounded-[10px] bg-canvas px-[10px] py-[7px]',
    'text-left text-[12px] text-ink transition-colors hover:bg-line',
    detail ? 'items-start' : 'items-center',
    className,
  ].filter(Boolean).join(' ');

  const body = (
    <>
      <span className={`flex h-[20px] w-[20px] shrink-0 items-center justify-center ${detail ? 'mt-[1px]' : ''}`}>
        {actor ? (
          <UserAvatar user={actor} size="xs" />
        ) : fromSupport ? (
          /* The desk, which is not a person and must not borrow a face — but
             is also not «nobody». Its rows were a dot and muted text, so a
             customer's own actions came out bold with a photo while the reply
             they came to read was the faintest line on the screen. A mark of
             the same size restores the weight without naming an agent. */
          <span className="flex h-[20px] w-[20px] items-center justify-center rounded-full bg-white text-muted">
            <LifeBuoy size={11} aria-hidden />
          </span>
        ) : (
          /* Genuinely nobody: a dot, in the same 20px box, so the feed keeps
             one left edge whatever the subject is. */
          <span className="h-[6px] w-[6px] rounded-full bg-faint" aria-hidden />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate leading-[18px] text-ink-soft">
          {actorName && <strong className="font-bold text-ink">{actorName} </strong>}
          {text}
          {issueKey && (
            <>
              {' '}
              <span className="font-semibold text-ink">
                {issueKey}{title ? `: ${title}` : ''}
              </span>
            </>
          )}
        </span>
        {detail && (
          <span className="mt-[3px] block truncate text-[11px] leading-[15px] text-ink-soft">{detail}</span>
        )}
      </span>

      {time && (
        <span className={`shrink-0 text-[10px] font-medium text-muted ${detail ? 'mt-[3px]' : ''}`}>{time}</span>
      )}
    </>
  );

  if (href) {
    return (
      <Link href={href} onClick={onClick} className={rowClass}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={rowClass}>
      {body}
    </button>
  );
}
