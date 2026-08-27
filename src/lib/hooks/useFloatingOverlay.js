'use client';

import { useEffect, useState } from 'react';
import { calculateFloatingOverlayPosition } from '@/lib/utils/floatingOverlay.mjs';

export function useFloatingOverlay({
  open,
  anchorRef,
  overlayRef,
  preferredPlacement = 'bottom',
  align = 'center',
  gap = 8,
  padding = 8,
}) {
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    placement: preferredPlacement,
    ready: false,
  });

  useEffect(() => {
    if (!open) return undefined;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      const overlay = overlayRef.current;
      if (!anchor || !overlay) return;

      const next = calculateFloatingOverlayPosition({
        anchorRect: anchor.getBoundingClientRect(),
        overlayWidth: overlay.offsetWidth,
        overlayHeight: overlay.offsetHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        preferredPlacement,
        align,
        gap,
        padding,
      });
      setPosition({ ...next, ready: true });
    };

    updatePosition();
    const frameId = window.requestAnimationFrame(updatePosition);
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updatePosition);
    if (overlayRef.current) resizeObserver?.observe(overlayRef.current);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [align, anchorRef, gap, open, overlayRef, padding, preferredPlacement]);

  return position;
}
