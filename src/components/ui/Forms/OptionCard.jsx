'use client';

// ─── UI Kit: Option Card ─────────────────────────────────────────────────────
// A card you pick one of: a glyph, a name, a sentence saying what choosing it
// means, and a tick on the chosen one.
//
// Ported from `qt-workspace/src/components/ui/Forms/OptionCard.jsx` with its
// numbers intact, because the two products draw the same invitation dialog and
// one control cannot be two controls. What is not ported is the hand-written
// geometry: the sizes live in a `data-ui-control` contract in `globals.css`, so
// this file says which option is chosen and the stylesheet says how a chosen
// option looks — the rule the rest of this kit already follows.

import React from 'react';
import { Check } from 'lucide-react';

/**
 * One choice in a set of them, drawn as a card rather than a radio.
 *
 * A radio row is the right control when the options differ by a word. These
 * differ by a consequence — «this person will be able to invite other people»
 * — and a sentence needs somewhere to live.
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
      data-ui-control="option-card"
      data-ui-state={selected ? 'selected' : 'idle'}
      className={`ui-native-control ${className}`.trim()}
    >
      {Icon && (
        <span data-ui-part="glyph">
          <Icon size={18} />
        </span>
      )}
      <span data-ui-part="body">
        <span data-ui-part="title">{title}</span>
        {description && <span data-ui-part="description">{description}</span>}
      </span>
      <span data-ui-part="tick">
        {selected && <Check size={12} />}
      </span>
    </button>
  );
}
