'use client';

import { useEffect, useRef } from 'react';

const modalStack = [];
let bodyLockCount = 0;
let previousBodyOverflow = '';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element => {
    if (element.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && element.getClientRects().length > 0;
  });
}

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  bodyLockCount += 1;

  return () => {
    bodyLockCount = Math.max(0, bodyLockCount - 1);
    if (bodyLockCount === 0) {
      document.body.style.overflow = previousBodyOverflow;
      previousBodyOverflow = '';
    }
  };
}

/**
 * Gives a custom modal the same keyboard contract as the shared Dialog:
 * initial focus, Tab containment, topmost-only Escape, scroll locking, and
 * focus restoration. The returned ref belongs on the element with
 * `role="dialog"`, which must also have `tabIndex={-1}` as a safe fallback.
 */
export function useModalFocus({ isOpen, onClose }) {
  const containerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return undefined;

    const token = { containerRef };
    const previouslyFocused = document.activeElement;
    const releaseBodyLock = lockBodyScroll();
    modalStack.push(token);

    const focusFrame = window.requestAnimationFrame(() => {
      if (modalStack[modalStack.length - 1] !== token) return;
      const container = containerRef.current;
      const target = container?.querySelector('[autofocus]')
        || focusableElements(container)[0]
        || container;
      target?.focus();
    });

    const handleKeyDown = event => {
      if (modalStack[modalStack.length - 1] !== token) return;

      if (event.key === 'Escape') {
        // A Select, Popover or ContextMenu owns the first Escape while it is
        // open. Its portal is outside the dialog DOM, so target containment
        // alone cannot express this layer relationship.
        if (document.querySelector('[data-qt-floating-overlay]')) return;
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab') return;
      const container = containerRef.current;
      if (!container) return;
      const focusable = focusableElements(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!container.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      const index = modalStack.indexOf(token);
      if (index !== -1) modalStack.splice(index, 1);
      releaseBodyLock();

      const nextModal = modalStack[modalStack.length - 1]?.containerRef.current;
      if (previouslyFocused?.isConnected
        && (!nextModal || nextModal.contains(previouslyFocused))) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  return containerRef;
}
