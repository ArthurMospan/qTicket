'use client';

import React from 'react';
import { Check } from 'lucide-react';

/**
 * A card you pick one of: a glyph, a name, a sentence explaining it, and a tick
 * on the chosen one. The role pickers in «Запросити учасника» and «Налаштування
 * учасника» are the two that exist today.
 *
 * Both dialogs drew it by hand and disagreed about every number — 14px radius
 * against 16, `p-3` against `p-4`, a 36px glyph against 40, a 13px title
 * against 14. Same control, two sizes, and nothing to say which was right. It
 * takes the larger of the two, because that one is on the kit's radius scale
 * (`--ui-radius-surface`) while 14px is on nothing.
 *
 * @param {React.ComponentType} props.icon The option's glyph, in the round chip.
 * @param {string} props.title What the option is called.
 * @param {string} props.description One sentence saying what choosing it means.
 * @param {boolean} props.selected Whether this is the current choice — the ink border and the tick.
 * @param {() => void} props.onClick Chooses it.
 * @param {boolean} props.disabled Unavailable: dimmed and not clickable.
 * @param {string} props.className Placement in the parent only.
 */
export default function OptionCard({
  icon: Icon,
  title,
  description,
  selected = false,
  onClick,
  disabled = false,
  className = '',
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`flex items-start gap-3 rounded-[16px] border-2 p-4 text-left transition-all disabled:cursor-default disabled:opacity-55 ${
        selected ? 'border-ink bg-canvas' : 'border-transparent bg-canvas hover:bg-line'
      } ${className}`}
    >
      {Icon && (
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-ink text-white' : 'bg-white text-muted'}`}>
          <Icon size={18} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold text-ink">{title}</span>
        {description && <span className="mt-1 block text-[11px] leading-4 text-muted">{description}</span>}
      </span>
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${selected ? 'bg-ink text-white' : 'border border-faint'}`}>
        {selected && <Check size={12} />}
      </span>
    </button>
  );
}
