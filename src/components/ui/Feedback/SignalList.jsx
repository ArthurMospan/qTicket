'use client';

// ─── UI Kit: Signal List ─────────────────────────────────────────────────────
// «Інсайти» and «Увага»: the handful of things about a workspace that somebody
// should look at.
//
// Both blocks were stacks of `Alert`, and `Alert` is a banner — a 16px-padded
// block with a 4px coloured left rule, a tinted fill and dark tinted text,
// designed to stop you. Five of them stacked is five things all shouting at
// once in four different colours, on the calmest screen in the product. That is
// the right component in the wrong place: an alert interrupts, and none of
// these interrupt. They are a reading.
//
// So: one quiet row each. A small tinted glyph carries the severity, the count
// carries the weight, and the sentence says what it is. Severity is never
// colour alone — every row has its own icon and its own words — and a workspace
// with nothing wrong says so in one line rather than a green banner.

import React from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Info, OctagonAlert } from 'lucide-react';

const TONES = {
  critical: { icon: OctagonAlert, color: '#ef4444', tint: '#fef2f2' },
  warning: { icon: AlertTriangle, color: '#b45309', tint: '#fffbeb' },
  info: { icon: Info, color: '#3b82f6', tint: '#eff6ff' },
  good: { icon: CheckCircle2, color: '#047857', tint: '#ecfdf5' },
};

/**
 * @typedef {object} Signal
 * @property {string} id
 * @property {'critical'|'warning'|'info'|'good'} tone How much it matters.
 * @property {string} title What it is, as a sentence.
 * @property {string} description The clause under it, where one helps.
 * @property {number|string} count The figure, printed at the end of the row.
 * @property {string} href Where to go to deal with it.
 */

/**
 * The short list of things worth a second look, ordered by how much they matter.
 *
 * A finding is a question, and a question wants an answer: give it an `href` or
 * an `onSelect` and the row becomes the way to the work behind the number.
 * Without either it is a reading and nothing more — which is what every one of
 * these was, on both analytics screens, for as long as they existed.
 *
 * @param {Signal[]} props.signals What to show. An empty list draws `emptyText` instead.
 * @param {(signal: Signal) => void} props.onSelect Opens a finding in place. `href` wins where a finding has a page of its own.
 * @param {string} props.emptyText The one line a workspace with nothing wrong gets.
 * @param {string} props.className Placement in the parent only.
 */
export default function SignalList({
  signals = [],
  onSelect,
  emptyText = 'Усе гаразд',
  className = '',
}) {
  if (signals.length === 0) {
    return (
      <div className={`flex items-center gap-2.5 py-2 ${className}`}>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: TONES.good.tint, color: TONES.good.color }}
        >
          <CheckCircle2 size={14} />
        </span>
        <span className="text-[13px] font-medium text-muted">{emptyText}</span>
      </div>
    );
  }

  return (
    <ul className={`flex flex-col ${className}`}>
      {signals.map(signal => {
        const tone = TONES[signal.tone] || TONES.info;
        const Icon = tone.icon;
        const body = (
          <>
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
              style={{ background: tone.tint, color: tone.color }}
            >
              <Icon size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-ink">{signal.title}</span>
              {signal.description && (
                <span className="mt-0.5 block truncate text-[11px] text-muted">{signal.description}</span>
              )}
            </span>
            {signal.count !== undefined && signal.count !== null && (
              <span className="ui-type-figure shrink-0 text-ink">{signal.count}</span>
            )}
          </>
        );
        // A row that leads somewhere is a control, and the chevron says so
        // before the pointer gets there — the hover tint alone was invisible
        // until you were already on top of it.
        const reach = 'group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-[10px] px-2 py-2.5 text-left transition-colors hover:bg-canvas/70';
        const trail = <ChevronRight size={14} className="shrink-0 text-faint transition-colors group-hover:text-ink" />;
        return (
          <li key={signal.id} className="border-b border-[color:var(--color-chart-grid)] last:border-0">
            {signal.href ? (
              <a href={signal.href} className={reach}>
                {body}
                {trail}
              </a>
            ) : onSelect ? (
              <button type="button" onClick={() => onSelect(signal)} className={reach}>
                {body}
                {trail}
              </button>
            ) : (
              <div className="flex items-center gap-2.5 py-2.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
