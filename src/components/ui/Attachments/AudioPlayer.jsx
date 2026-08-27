'use client';

// ─── UI Kit: Audio Player ────────────────────────────────────────────────────
// A sound file you can hear without leaving the page.
//
// There was exactly one of these in the product and it was in the QuickTeam+
// portal, welded into `AudioCard`. Everywhere a colleague actually sends a voice
// note — a task's attachments, a channel, a task thread — the file was a grey
// page glyph that opened a full-screen black lightbox to play twelve seconds of
// audio. That is the whole reason this moved into the kit: the behaviour was
// already written and only one screen out of four could use it.
//
// Playback state is read off the <audio> element rather than from the clicks,
// because the browser pauses on its own — losing focus, another track starting,
// the phone ringing — and a state built from clicks drifts out of sync with the
// sound the moment it does.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import MediaPlayButton from '@/components/ui/MediaPlayButton';
import { formatMediaTime } from '@/lib/utils/attachmentKinds.mjs';

// Two clips playing at once is never what anyone meant. Every player marks its
// own element, and starting one stops the rest — the same rule a messenger
// applies, and cheaper than a context that every screen would have to mount.
const PLAYER_SELECTOR = 'audio[data-qt-audio-player]';

/**
 * One audio file: play, scrub, and how far in you are.
 *
 * @param {string} props.src Where the sound is. Without it the control is present but disabled — a private attachment whose signed URL has not arrived yet.
 * @param {string} props.title The file's name.
 * @param {string} props.meta The quiet line under it — kind and size, usually.
 * @param {boolean} props.dark The player sits on a dark surface (own message bubble).
 * @param {React.ReactNode} props.actions Row actions — download, remove — placed after the title.
 * @param {string} props.className Placement in the parent only.
 */
export default function AudioPlayer({
  src,
  title,
  meta,
  dark = false,
  actions,
  className = '',
}) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return undefined;
    const onPlay = () => {
      setPlaying(true);
      document.querySelectorAll(PLAYER_SELECTOR).forEach(other => {
        if (other !== element) other.pause();
      });
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => { setPlaying(false); setElapsed(0); };
    const onTime = () => setElapsed(element.currentTime);
    const onMeta = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    element.addEventListener('play', onPlay);
    element.addEventListener('pause', onPause);
    element.addEventListener('ended', onEnded);
    element.addEventListener('timeupdate', onTime);
    element.addEventListener('loadedmetadata', onMeta);
    return () => {
      element.removeEventListener('play', onPlay);
      element.removeEventListener('pause', onPause);
      element.removeEventListener('ended', onEnded);
      element.removeEventListener('timeupdate', onTime);
      element.removeEventListener('loadedmetadata', onMeta);
    };
  }, [src]);

  const toggle = useCallback(() => {
    const element = audioRef.current;
    if (!element) return;
    if (element.paused) element.play().catch(() => {});
    else element.pause();
  }, []);

  const seekTo = useCallback(seconds => {
    const element = audioRef.current;
    if (!element || !Number.isFinite(element.duration)) return;
    element.currentTime = Math.min(Math.max(seconds, 0), element.duration);
    setElapsed(element.currentTime);
  }, []);

  const seekFromPointer = event => {
    const element = audioRef.current;
    if (!element || !Number.isFinite(element.duration)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    seekTo(((event.clientX - bounds.left) / bounds.width) * element.duration);
  };

  const onSeekKeyDown = event => {
    const element = audioRef.current;
    if (!element || !Number.isFinite(element.duration)) return;
    const jumps = {
      ArrowLeft: () => seekTo(element.currentTime - 5),
      ArrowRight: () => seekTo(element.currentTime + 5),
      Home: () => seekTo(0),
      End: () => seekTo(element.duration),
    };
    const jump = jumps[event.key];
    if (!jump) return;
    event.preventDefault();
    jump();
  };

  const progress = duration > 0 ? Math.min((elapsed / duration) * 100, 100) : 0;

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
      {src && (
        <audio ref={audioRef} src={src} preload="metadata" playsInline data-qt-audio-player="" />
      )}

      <div className="flex min-w-0 items-center gap-2.5">
        <MediaPlayButton playing={playing} disabled={!src} dark={dark} onClick={toggle} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[12px] font-semibold ${dark ? 'text-white' : 'text-ink'}`}>
            {title}
          </span>
          <span className={`block text-[10px] tabular-nums ${dark ? 'text-white/55' : 'text-faint'}`}>
            {formatMediaTime(elapsed)}
            {duration > 0 ? ` / ${formatMediaTime(duration)}` : ''}
            {meta ? ` · ${meta}` : ''}
          </span>
        </span>
        {actions}
      </div>

      {/* The track is the one control here that is not a button, so it says so
          out loud: a slider with a value, arrow keys that move it and Home/End
          that jump to the ends. */}
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Перемотка: ${title || 'аудіо'}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-valuetext={`${formatMediaTime(elapsed)} з ${formatMediaTime(duration)}`}
        onClick={seekFromPointer}
        onKeyDown={onSeekKeyDown}
        className={`relative h-[6px] w-full cursor-pointer rounded-full ${dark ? 'bg-white/20' : 'bg-canvas'}`}
      >
        <div
          className={`absolute left-0 top-0 h-full rounded-full ${dark ? 'bg-white' : 'bg-ink'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
