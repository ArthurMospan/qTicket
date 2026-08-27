'use client';

// src/components/workspace/LiveTimeTracking.jsx
// The kit's TimeTrackingControl with the running clock wired to it.
//
// The store ticks `timerElapsed` once a second while a timer runs, and a screen
// that reads it in its own body re-renders whole once a second — the task page
// is two thousand lines of it. That was cheap in React and expensive in the
// DOM: the description is markdown, and until MarkdownViewer's renderer map was
// hoisted out of its render, a second was enough to replace every node in it.
// The map is fixed now, but the second-by-second render of an entire screen is
// still work nobody asked for, and the next reader of a Markdown viewer should
// not have to know that.
//
// So the subscription lives here, in the smallest component that needs it —
// the same shape MobileNav's timer capsule already uses. While no timer runs on
// this entity the selector returns a constant and nothing re-renders at all.

import React from 'react';
import { TimeTrackingControl } from '@/components/ui';
import useWorkspaceStore from '@/store/useWorkspaceStore';

/**
 * @param {boolean} props.running Whether the timer counting right now is this entity's.
 * @param {number} props.spentMinutes Time already logged, in minutes; the clock counts up from it.
 * @param {string} props.restingLabel What the total reads while no timer runs.
 * The rest of the props are TimeTrackingControl's own.
 */
export default function LiveTimeTracking({ running = false, spentMinutes = 0, restingLabel, ...rest }) {
  const elapsed = useWorkspaceStore(state => (running ? state.timerElapsed : 0));
  const formatElapsed = useWorkspaceStore(state => state.formatElapsed);

  return (
    <TimeTrackingControl
      {...rest}
      running={running}
      spentLabel={running ? formatElapsed((spentMinutes * 60) + elapsed) : restingLabel}
    />
  );
}
