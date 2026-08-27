'use client';
import React from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import Sparkline from '@/components/ui/Charts/Sparkline';

// One number on an analytics screen.
//
// The icon chip is deliberately not themable. Every KPI row used to pick its
// own hue, which made a set of four cards read as four unrelated widgets and
// implied a status the number alone was already carrying. One grey chip with an
// ink glyph keeps every analytics surface looking like one system.
//
// Two things changed when analytics got a type scale. The figure is
// `ui-type-metric-value` rather than a hand-typed 26px, and it uses proportional
// digits: `tabular-nums` gives every digit the width of a zero, which at this
// size makes a number like 121 look visibly loose. Tabular is for columns of
// figures, and this is not one.
//
// And the label under it is sentence case. It was 11px bold uppercase with
// letter-spacing — the eyebrow style — which meant the quietest text on the
// card was set in the loudest available treatment, four times per row.
//
// On a phone the whole row is two columns wide, and the arithmetic stopped
// working: a 151px tile minus 20px of padding on each side leaves 111px, and
// «345 / 400» at 26px needs 121 — so the headline figure of an analytics screen
// was reading «345 / …». With a sparkline on the same line there were 31px
// left, and «18» became «1…». Below `md` the padding drops to 16px, the figure
// steps down through the type scale, and the sparkline stands down: it is a
// glyph worth 68px next to a figure that has 119, and every card that carries
// one already says in its own sub-line which screen draws the full chart.

/**
 * One number on an analytics screen: the figure, what it counts, how it moved,
 * and the shape it moved in.
 *
 * @param {React.ComponentType} props.icon Glyph in the grey chip. The chip is never themable — see above.
 * @param {string|number} props.value The figure itself.
 * @param {string} props.label What it counts.
 * @param {string} props.sub Smaller line under the label — the period, usually.
 * @param {number} props.trend Percent change; sign decides the arrow and the colour.
 * @param {number[]} props.series Recent history, oldest first, drawn as a sparkline beside the figure.
 * @param {() => void} props.onClick Makes the card a control, with the hover ring that goes with it.
 * @param {string} props.className Placement in the parent only.
 */
export default function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  series,
  onClick,
  className = '',
}) {
  const content = (
    <div className={`rounded-[16px] border border-transparent bg-white p-5 transition-all duration-200 max-md:p-4 ${onClick ? 'cursor-pointer hover:ring-4 hover:ring-line' : ''} ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        {Icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-canvas">
            <Icon size={16} className="text-ink" />
          </div>
        )}
        {trend !== undefined && trend !== null && (
          <span className={`flex items-center gap-1 text-[11px] font-semibold ${trend >= 0 ? 'text-success' : 'text-danger'}`}>
            {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-3">
        <p className="ui-type-metric-value min-w-0 truncate text-ink">{value}</p>
        {series && series.length > 1 && <Sparkline values={series} className="mb-0.5 max-md:hidden" />}
      </div>
      <p className="mt-1.5 text-[12px] font-semibold text-ink">{label}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );

  // A card that leads somewhere is a control, and a `div` with an onClick is
  // not one: it takes no focus, answers no Enter, and a screen reader walks
  // straight past it. The wrapper is a real button, stripped of its own chrome
  // so the card still draws itself.
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="group block w-full text-left">
        {content}
      </button>
    );
  }
  return content;
}
