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
  // `--qt-keyboard-inset` is the second half of that: the measured overlap, for
  // the one box still entitled to subtract it.
  //
  // Below md nothing subtracts it any more, and that is deliberate. `dvh`
  // accounts for the browser's chrome but not for the keyboard, so on iOS a
  // full-height shell keeps its box while the bottom third of it is covered —
  // and WebKit already knows that. On focus it scrolls the ancestor scrollers
  // and pans the visual viewport down until the field is out from under the
  // keys. A shell that then shortens itself by the same overlap corrects a
  // second time for a keyboard that has already been paid for: the field lands
  // a keyboard's height above the visible window, and the overlap it vacated is
  // a bare strip any drag can find. A Dialog does neither, which is why the same
  // editor behaves inside one; below md the shell now does neither either.
  //
  // At md and above the subtraction stays, on `body` (globals.css). That is the
  // tablet case — an iPad in portrait is 768pt wide, past this line, and its
  // keyboard does trip the fraction above.
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
