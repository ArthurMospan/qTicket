'use client';

import { useEffect, useState } from 'react';

// True while the caret is in a composer.
//
// `useKeyboardOpen` answers a different question — how much of the viewport the
// on-screen keyboard is covering — and it answers it late and conditionally: it
// cannot fire until the keys have already begun covering the screen, it ignores
// an overlap under a third of the viewport (a landscape phone, an iPad's split
// keyboard, a hardware one), and it says «closed» the moment the keyboard is
// dismissed while the field still holds the caret. The bar is not about the
// keyboard. Somebody writing a message is not navigating, and the bar's 78px is
// the difference between one visible message and three.
//
// The composer is identified by the shelf it sits on. `.chat-composer-dock` is
// the class every composer in the product wears — in qTicket that is the one on
// a request's conversation (`UnifiedTimeline` through `ChatComposerDock`), and
// there is exactly one because the workspace messenger this fork inherited was
// deleted. Keyed on the shelf rather than on that call site, so a second
// conversation added later inherits this by being a composer.
const COMPOSER_SELECTOR = '.chat-composer-dock';

export function useComposerFocus(pathname) {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      const active = document.activeElement;
      // Anything focusable inside a composer dock is composing. Attach, emoji,
      // send and the mention rows are all children of the dock, and a tap on one
      // of them — which is what Android Chrome does with a button — must not read
      // as «stopped writing» and bring the bar back over the field.
      const next = Boolean(active && active.closest?.(COMPOSER_SELECTOR));
      setFocused(previous => (previous === next ? previous : next));
    };
    // Read a frame after the event rather than during it. `focusout` fires while
    // `document.activeElement` is still `body`, and picking a mention from the
    // menu blurs the field and focuses it again on a 0ms timer — which lands
    // before the next animation frame, so reading the settled answer is what
    // keeps the bar from flashing back between the two.
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(read); };

    read();
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    // And the case neither of those covers: removing a focused element from the
    // document fires no `focusout` at all — `activeElement` silently falls back
    // to <body>. Closing the request's quick view with the caret still in its
    // composer unmounts the dock exactly that way, and on iOS a tap on a
    // <button> moves no focus either, so nothing would ever correct the flag and
    // the bar would stay gone across the whole app. `pointerdown` precedes the
    // focus change and the deferred read still sees the settled answer, so the
    // next touch anywhere restores the truth.
    document.addEventListener('pointerdown', schedule, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      document.removeEventListener('pointerdown', schedule, true);
    };
  }, []);

  // A client navigation can leave a conversation without any of the three events
  // firing. Nobody carries a composer to the next screen, so the honest answer
  // on arrival is «not writing»; if a composer there really does hold the caret,
  // the deferred read above says so on the same frame — a microtask still lands
  // before the next one. Deferred rather than synchronous because a setState in
  // an effect body cascades a second render before paint.
  useEffect(() => { queueMicrotask(() => setFocused(false)); }, [pathname]);

  // Published on <body> as well, so the CSS that gives a screen room for the bar
  // can stop giving it — the same contract `data-keyboard` and `data-mobile-nav`
  // already have, and read in the same place in globals.css.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.dataset.composer = focused ? 'focused' : 'idle';
    return () => { delete document.body.dataset.composer; };
  }, [focused]);

  return focused;
}

export default useComposerFocus;
