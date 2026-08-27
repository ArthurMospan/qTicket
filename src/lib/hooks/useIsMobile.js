'use client';

// src/lib/hooks/useIsMobile.js — viewport gate matching Tailwind's `md` breakpoint.
// Returns null on the first client render, then true/false. Layouts should wait
// for the resolved value before mounting viewport-specific navigation so hidden
// nav variants do not briefly subscribe to Firestore.
import { useState, useEffect } from 'react';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(null);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}
