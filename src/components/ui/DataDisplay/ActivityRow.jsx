'use client';

import React from 'react';
import { LifeBuoy } from 'lucide-react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import Pill from '@/components/ui/DataDisplay/Pill';

// ─── UI Kit: Activity Row ────────────────────────────────────────────────────
// One line of «що сталося»: who, what, to which request, when.
//
// Not `TaskRow` with different content. A task row is about a record — its
// status, its priority, its people — and is read down a column by comparing
// those. This is about an *event*, read newest-first, and the request it
// happened to is the object of the sentence rather than the subject of the row.
// Giving one component both jobs is how a list of things and a list of
// happenings stop looking like different questions.
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
 * @param {() => void} props.onClick Opens the request.
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
  onClick,
  className = '',
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-start gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors hover:bg-canvas ${className}`}
    >
      <span className="mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center">
        {actor ? (
          <UserAvatar user={actor} size="sm" />
        ) : fromSupport ? (
          /* The desk, which is not a person and must not borrow a face — but
             is also not «nobody». Its rows were a 7px dot and muted text, so a
             customer's own actions came out bold with a photo while the reply
             they came to read was the faintest line on the screen. A mark of
             the same size restores the weight without naming an agent. */
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-muted">
            <LifeBuoy size={14} aria-hidden />
          </span>
        ) : (
          /* Genuinely nobody: a dot, at the same 28px, so the feed keeps one
             left edge whatever the subject is. */
          <span className="h-[7px] w-[7px] rounded-full bg-line-strong" aria-hidden />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-[13px] leading-[18px] text-muted">
          {actorName && <strong className="font-semibold text-ink">{actorName} </strong>}
          {text}
          {issueKey && (
            <>
              {' '}
              <span className="font-semibold text-ink">{issueKey}</span>
            </>
          )}
          {title && <span className="text-muted"> · {title}</span>}
        </span>
        {detail && (
          <span className="mt-0.5 block truncate text-[12px] leading-[16px] text-faint">{detail}</span>
        )}
      </span>

      {time && (
        <Pill tone="surface" size="sm" weight="medium" className="mt-[1px] shrink-0">
          {time}
        </Pill>
      )}
    </button>
  );
}
