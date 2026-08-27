'use client';

import React from 'react';
import { Lock, ShieldCheck, TriangleAlert } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';

/**
 * The question asked before a workspace loses something.
 *
 * ── Why it is not a confirm box ─────────────────────────────────────────
 *
 * It was one: a title, a wall of plain text with bullet characters in it, and
 * two buttons of equal weight. Which is the shape the product uses for «видалити
 * спринт?» — one fact, one decision — and this is five or six facts of two
 * different kinds, each with its own consequence, none of them destructive. Read
 * as a paragraph they looked like an error log, and the one sentence that
 * actually matters — that nothing is deleted — was a line in the middle of it.
 *
 * ── The two kinds, and why they are drawn differently ───────────────────
 *
 * Something that **turns off** is a switch that stops working and keeps its
 * setting: a lock, and the name of the thing. Something **already past its new
 * ceiling** is a number that stops growing while everything under it goes on
 * working: a figure on the right, and the sentence that says what happens to the
 * part that is over.
 *
 * ── The buttons are not a coin toss ─────────────────────────────────────
 *
 * Somebody opening this is one click away from turning five things off, and a
 * pair of equally weighted buttons does not ask a question — it splits the
 * difference. Staying is the filled one and the one the keyboard lands on;
 * going down is a quiet button that says what it does. It is not a dark
 * pattern: the downgrade is one click either way, it is never hidden, and it is
 * reversible — which the footnote says, because that is the fact that makes an
 * honest default honest.
 *
 * @param {boolean} props.isOpen Whether it is on screen.
 * @param {object} props.notice From `planDowngradeNotice` — the whole dialog, in data.
 * @param {() => void} props.onStay Keeps the current plan. The × , the overlay and Escape do this too.
 * @param {() => void} props.onConfirm Goes ahead with the downgrade.
 * @param {boolean} props.busy The switch is in flight.
 */
export default function PlanDowngradeDialog({ isOpen, notice, onStay, onConfirm, busy = false }) {
  if (!notice) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onStay}
      size="md"
      title={notice.title}
      footer={(
        <>
          <Button style="ghost" size="md" onClick={onConfirm} loading={busy}>
            {notice.confirmLabel}
          </Button>
          <Button style="primary" size="md" onClick={onStay} disabled={busy} autoFocus>
            {notice.stayLabel}
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        {/* The green is doing one job: this is the reassuring half, and it is
            the half people skip. It is `success` rather than the plan violet
            because nothing here is for sale. */}
        <p className="flex gap-3 rounded-[12px] bg-success-soft px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
          <ShieldCheck size={16} className="mt-[2px] shrink-0 text-success" aria-hidden />
          <span>{notice.reassurance}</span>
        </p>

        {notice.turnedOff.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="ui-type-eyebrow">{notice.turnedOffTitle}</p>
            <ul className="flex flex-col gap-[6px]">
              {notice.turnedOff.map(label => (
                <li key={label} className="flex items-center gap-2.5 text-[13px] text-ink">
                  <Lock size={14} className="shrink-0 text-muted" aria-hidden />
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {notice.overCeiling.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="ui-type-eyebrow">{notice.overCeilingTitle}</p>
            <ul className="flex flex-col gap-2">
              {notice.overCeiling.map(limit => (
                <li
                  key={limit.id}
                  data-ui-surface="compact-bordered-panel"
                  data-ui-padding="wide"
                  className="ui-surface flex items-start gap-2.5"
                >
                  <TriangleAlert size={14} className="mt-[2px] shrink-0 text-warning" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-bold text-ink">{limit.label}</span>
                      <span className="shrink-0 text-[13px] font-bold tabular-nums text-warning">
                        {limit.reading}
                      </span>
                    </span>
                    {limit.hint ? (
                      <span className="mt-[2px] block text-[11px] leading-relaxed text-muted">{limit.hint}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[12px] leading-relaxed text-muted">{notice.footnote}</p>
      </div>
    </Dialog>
  );
}
