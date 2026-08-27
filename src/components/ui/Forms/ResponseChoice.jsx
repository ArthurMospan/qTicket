'use client';

// ─── UI Kit: Response Choice ─────────────────────────────────────────────────
// «Буду / Можливо / Не буду» — the answer to a calendar invitation.
//
// The same control existed three times, in three sizes, in three files: a 62px
// tile in the event dialog, an 8px button on the event page, and a 7px chip in
// the notification panel. Each copy re-declared the three options as well as
// the geometry, so the vocabulary of the control lived in three places too.
//
// Tone follows size rather than being its own prop, the way `TextAction` makes
// weight follow size: the tile is the deliberate, one-per-event choice and
// carries the semantic colours; the two smaller ones are quick corrections in a
// list and settle on `bg-ink`, because three coloured chips in a notification
// row read as three different notifications.

import React from 'react';
import { Check, CircleHelp, X } from 'lucide-react';

const CHOICES = [
  { value: 'accepted', label: 'Буду', icon: Check, activeClass: 'border-success bg-success text-white' },
  { value: 'tentative', label: 'Можливо', icon: CircleHelp, activeClass: 'border-warning-solid bg-warning-solid text-white' },
  { value: 'declined', label: 'Не буду', icon: X, activeClass: 'border-danger bg-danger-solid text-white' },
];

// `off` is keyed by the background the group sits on, because an unselected
// chip has to be visible against it: on white it needs a ring, on canvas the
// fill alone is enough. Only `sm` appears on both — it is the one that shows up
// in the notification list and again in the live toast.
const SIZES = {
  tile: {
    group: 'grid grid-cols-3 gap-2',
    button: 'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-[12px] border text-[11px] font-bold transition-all disabled:opacity-50',
    off: {
      surface: 'border-black/[0.06] bg-white text-muted hover:border-black/15 hover:text-ink',
      canvas: 'border-black/[0.06] bg-white text-muted hover:border-black/15 hover:text-ink',
    },
    semantic: true,
    icon: 16,
  },
  md: {
    group: 'flex flex-wrap items-center gap-2',
    button: 'rounded-[8px] px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50',
    off: {
      surface: 'bg-white text-muted hover:text-ink',
      canvas: 'bg-white text-muted hover:text-ink',
    },
    on: 'bg-ink text-white',
  },
  sm: {
    group: 'flex items-center gap-1.5',
    button: 'rounded-[7px] px-2 py-1 text-[9px] font-bold transition-colors disabled:opacity-50',
    off: {
      surface: 'bg-white text-muted ring-1 ring-black/[0.07] hover:text-ink',
      canvas: 'bg-canvas text-muted hover:text-ink',
    },
    on: 'bg-ink text-white',
  },
};

/**
 * The three answers to a calendar invitation, as one group of toggle buttons.
 * State is reported as `aria-pressed`, so this is one control with a selected
 * answer rather than three buttons that happen to look related.
 *
 * @param {'accepted'|'tentative'|'declined'|null} props.value The current answer.
 * @param {(value: string, event) => void} props.onChange Fires with the answer that was pressed.
 * @param {'tile'|'md'|'sm'} props.size Which of the three geometries to draw; the tile also carries the semantic colours.
 * @param {'surface'|'canvas'} props.surface What the group sits on, which decides how an unselected answer stays visible.
 * @param {boolean} props.disabled Blocks every answer while one is saving.
 * @param {string} props.className Placement in the parent only.
 */
export default function ResponseChoice({
  value,
  onChange,
  size = 'md',
  surface = 'surface',
  disabled = false,
  className = '',
}) {
  const chrome = SIZES[size] ?? SIZES.md;

  return (
    <div className={`${chrome.group} ${className}`.trim()}>
      {CHOICES.map(choice => {
        const Icon = choice.icon;
        const selected = value === choice.value;
        const state = selected
          ? (chrome.semantic ? choice.activeClass : chrome.on)
          : (chrome.off[surface] ?? chrome.off.surface);
        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={event => onChange?.(choice.value, event)}
            className={`${chrome.button} ${state}`}
          >
            {chrome.icon && <Icon size={chrome.icon} />}
            {choice.label}
          </button>
        );
      })}
    </div>
  );
}
