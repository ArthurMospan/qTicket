'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { colors, spacing, sizing, shadows, transitions } from '@/lib/design/tokens';
import { useFloatingOverlay } from '@/lib/hooks/useFloatingOverlay';
import { useFloatingOverlayEscape } from '@/lib/hooks/useFloatingOverlayEscape';

/**
 * Popover Component
 *
 * A generic popover container that appears near a trigger element.
 * Includes a close button and arrow pointing to the trigger.
 *
 * @component
 * @param {Object} props
 * @param {React.ReactNode} props.trigger - Element that triggers the popover
 * @param {React.ReactNode} props.children - Content to display in the popover
 * @param {string} [props.position] - Position relative to trigger: 'top', 'bottom', 'left', 'right' (default: 'bottom')
 * @param {string} [props.className] - Additional CSS classes
 *
 * @example
 * <Popover
 *   trigger={<button>Info</button>}
 *   position="top"
 * >
 *   <div>Popover content goes here</div>
 * </Popover>
 */
// Two call sites each passed a raw CSS length here ('6px', '16px'), which is
// the free-value prop the kit does not allow: the decision then lives at the
// call site and nothing can propagate to it. `tight` is the hovercard density.
export const PADDINGS = {
  default: spacing.lg,
  tight: spacing.componentGap.tight,
};

/**
 * A panel anchored to whatever opened it, rendered in a portal so no parent's
 * `overflow` can clip it. It owns its open state — pass a `trigger`, not an
 * `open` flag.
 *
 * @param {React.ReactNode} props.trigger The element that opens it; cloned, so it keeps its own styling.
 * @param {React.ReactNode} props.children Panel content.
 * @param {'start'|'center'|'end'} props.align Which edge of the trigger the panel lines up with.
 * @param {string} props.position Which side of the trigger it opens on.
 * @param {number} props.gap Distance in pixels between trigger and panel.
 * @param {number} props.minWidth Minimum panel width in pixels.
 * @param {string} props.padding Inner spacing token.
 * @param {boolean} props.hideArrow Drops the pointer arrow.
 * @param {boolean} props.hideCloseIcon Drops the × in the corner.
 * @param {(open: boolean) => void} props.onOpenChange Fires when it opens or closes.
 * @param {string} props.triggerClassName Placement of the trigger wrapper only.
 * @param {string} props.className Placement of the panel only.
 */
export function Popover({
  trigger,
  children,
  position = 'bottom',
  align = 'center',
  gap = 8,
  className = '',
  hideCloseIcon = false,
  hideArrow = false,
  minWidth = '240px',
  padding = 'default',
  triggerClassName = '',
  onOpenChange,
}) {
  const [isOpen, setIsOpenState] = useState(false);
  const setIsOpen = useCallback((value) => {
    setIsOpenState(value);
    onOpenChange?.(value);
  }, [onOpenChange]);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const popoverPosition = useFloatingOverlay({
    open: isOpen,
    anchorRef: triggerRef,
    overlayRef: popoverRef,
    preferredPlacement: position,
    align,
    gap,
  });
  useFloatingOverlayEscape({ open: isOpen, onClose: () => setIsOpen(false) });

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current
        && !containerRef.current.contains(event.target)
        && !popoverRef.current?.contains(event.target)
        && !event.target.closest?.('[data-qt-floating-overlay]')
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, setIsOpen]);

  const arrowStyle = {
    top: { bottom: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
    bottom: { top: -5, left: '50%', transform: 'translateX(-50%) rotate(45deg)' },
    left: { right: -5, top: '50%', transform: 'translateY(-50%) rotate(45deg)' },
    right: { left: -5, top: '50%', transform: 'translateY(-50%) rotate(45deg)' },
  }[popoverPosition.placement];

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {/* The trigger the caller passes is already a control — a Button, an
          IconAction, a link. This wrapper only catches its click and measures
          it, so it says `presentation` and takes the keyboard handler too:
          activating the inner control by keyboard fires a click that bubbles
          here, and a caller who passes a bare span still gets one that opens. */}
      <div
        ref={triggerRef}
        role="presentation"
        tabIndex={-1}
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          setIsOpen(!isOpen);
        }}
        className={triggerClassName}
      >
        {trigger}
      </div>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          data-qt-floating-overlay
          style={{
            position: 'fixed',
            top: popoverPosition.top,
            left: popoverPosition.left,
            visibility: popoverPosition.ready ? 'visible' : 'hidden',
            backgroundColor: colors.surface,
            border: `1px solid ${colors.border.light}`,
            borderRadius: sizing.radius.xl,
            boxShadow: shadows.xl,
            zIndex: 1000,
            minWidth,
            maxWidth: 'calc(100vw - 16px)',
            maxHeight: 'calc(100dvh - 16px)',
            overflowY: 'auto',
            padding: PADDINGS[padding] ?? PADDINGS.default,
          }}
        >
          {/* Arrow pointing to trigger */}
          {!hideArrow && <div
            style={{
              position: 'absolute',
              width: 10,
              height: 10,
              backgroundColor: colors.surface,
              border: `1px solid ${colors.border.light}`,
              ...arrowStyle,
            }}
          />}

          {/* Close button — content may opt out (hideCloseIcon) and render its
              own cancel/apply controls via function-children instead */}
          {!hideCloseIcon && <button
            type="button"
            aria-label="Закрити"
            onClick={() => setIsOpen(false)}
            style={{
              position: 'absolute',
              top: spacing.sm,
              right: spacing.sm,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '32px',
              height: '32px',
              backgroundColor: 'transparent',
              border: 'none',
              color: colors.text.muted,
              cursor: 'pointer',
              transition: `color ${transitions.default} ${transitions.timing}`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = colors.text.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = colors.text.muted;
            }}
          >
            <X size={16} />
          </button>}

          {/* Content */}
          <div style={{ paddingTop: hideCloseIcon ? 0 : spacing.sm }}>
            {typeof children === 'function' ? children({ close: () => setIsOpen(false) }) : children}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default Popover;
