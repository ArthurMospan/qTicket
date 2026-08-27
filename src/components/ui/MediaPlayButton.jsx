'use client';

// ─── UI Kit: Media Play Button ───────────────────────────────────────────────
// Play and pause for an audio card. Deliberately not `IconAction`: its icons
// are filled rather than outlined, and it stays ink on canvas rather than
// going muted. A hollow grey triangle does not read as "press this to hear it",
// which is why the survey's answer here was "treat it as a new element" instead
// of pulling it onto the shared icon-button scale.

import React from 'react';
import { Pause, Play } from 'lucide-react';

/**
 * The play/pause control of an audio card.
 *
 * @param {boolean} props.playing Whether the track is running; this swaps the glyph and the accessible name.
 * @param {boolean} props.disabled No track to play yet.
 * @param {boolean} props.dark The button sits on a dark surface — an own message bubble — where canvas-on-ink is invisible.
 * @param {(event) => void} props.onClick Toggles playback.
 * @param {string} props.className Placement in the parent only.
 */
export default function MediaPlayButton({ playing = false, disabled = false, dark = false, onClick, className = '', ...props }) {
  const Icon = playing ? Pause : Play;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={playing ? 'Пауза' : 'Відтворити'}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] transition-colors disabled:opacity-40 ${
        dark ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-canvas text-ink hover:bg-line'
      } ${className}`}
      {...props}
    >
      {/* The triangle is optically off-centre in its own box, so play nudges
          right by 2px and pause does not. */}
      <Icon size={14} fill="currentColor" className={playing ? '' : 'ml-[2px]'} />
    </button>
  );
}
