'use client';

// src/lib/hooks/useIsMobile.js — viewport gate matching Tailwind's `md` breakpoint.
// Returns null on the first client render, then true/false. Layouts should wait
// for the resolved value before mounting viewport-specific navigation so hidden
// nav variants do not briefly subscribe to Firestore.
//
// The query is `(width < 48rem)` because that is character for character what
// Tailwind v4 compiles `max-md:` into, and this hook is the JS half of gates
// whose other half is a `md:` or `max-md:` utility. `(max-width: 767px)` stood
// here and is not the same query: at a viewport of 767.5px, ordinary under
// browser zoom or a fractional device pixel ratio, the CSS half fired and this
// one did not. The workspace shell is where that cost the most. The branded rail
// is mounted on `isMobile === false` and then hidden by its own `hidden md:flex`;
// the tab bar is mounted on `isMobile === true` inside a `md:hidden`. In that
// fractional band the rail was rendered and hidden while the bar was never
// rendered at all — a workspace with no navigation of either kind. Only that band
// moves: at 767 both queries are true and at 768 both are false, so nothing at or
// above md changes. Range syntax is safe to ask of the browser here, because
// every `max-md:` utility in the bundle is already emitted this way — a browser
// that cannot parse it has no phone layout to gate.
import { useState, useEffect } from 'react';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(null);
  useEffect(() => {
    const mq = window.matchMedia('(width < 48rem)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}
