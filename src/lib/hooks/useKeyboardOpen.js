'use client';

import { useEffect, useState } from 'react';

// True while the on-screen keyboard covers part of the viewport.
//
// The layout viewport already accounts for every other piece of mobile browser
// chrome — the URL bar, the toolbar, the home indicator — which is why a fixed
// bottom bar behaves without any inset arithmetic. The keyboard is the
// exception: depending on the platform and the `interactive-widget` mode it
// either hides a fixed element behind itself or leaves it floating on top, and
// both look like a bug. visualViewport is the only API that reports the box
// that is actually visible.
//
// The threshold is a fraction rather than a pixel count so it holds on a small
// phone and on a tablet: a collapsing URL bar costs well under a fifth of the
// height, a keyboard costs a third or more.
const KEYBOARD_FRACTION = 0.3;

export function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  // How much of the layout viewport the keyboard is sitting on top of. Zero
  // whenever it is closed, and zero on any browser that shrinks the layout
  // viewport itself — there the number the app shell needs is already in
  // `100dvh`, and this measurement comes out at nothing on its own.
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = typeof window === 'undefined' ? null : window.visualViewport;
    if (!viewport) return undefined;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const hidden = window.innerHeight - viewport.height;
      const next = hidden > window.innerHeight * KEYBOARD_FRACTION;
      setOpen(previous => (previous === next ? previous : next));
      // Only a real keyboard is subtracted. Between the two there is a URL bar
      // that collapses and expands as you scroll, and following that with the
      // height of the app shell is a page that shivers while you read it.
      const nextInset = next ? Math.round(hidden) : 0;
      setInset(previous => (previous === nextInset ? previous : nextInset));
    };
    // resize fires per animation frame while the keyboard slides in.
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    viewport.addEventListener('resize', schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
    };
  }, []);

  // Published on <body> as well, so CSS can collapse the space the bar reserves
  // without every screen subscribing to this hook.
  //
  // `--qt-keyboard-inset` is the second half of that, and it is what makes a
  // chat usable on a phone at all. The app shell is `height: 100dvh` with
  // `overflow: hidden`, and `dvh` accounts for the browser's chrome but not for
  // the keyboard: on iOS the shell stays full height while a third of it is
  // covered, which puts the composer — the last thing in the column — under the
  // keys, where it cannot be seen and cannot be scrolled to. Subtracting the
  // measured overlap from the shell's height is what stands the column back up:
  // the field ends exactly where the keyboard begins.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.dataset.keyboard = open ? 'open' : 'closed';
    document.body.style.setProperty('--qt-keyboard-inset', `${inset}px`);
    return () => {
      delete document.body.dataset.keyboard;
      document.body.style.removeProperty('--qt-keyboard-inset');
    };
  }, [inset, open]);

  return open;
}

export default useKeyboardOpen;
