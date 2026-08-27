'use client';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Check } from 'lucide-react';
import { useFloatingOverlay } from '@/lib/hooks/useFloatingOverlay';
import { useFloatingOverlayEscape } from '@/lib/hooks/useFloatingOverlayEscape';

// UI Kit: ContextMenu Component (Atom)
// Features standard rounded-[12px] corners, soft shadow, and unified font-medium labels

/**
 * The dropdown menu behind a ⋮ or any other trigger. Rendered in a portal, so a
 * row with `overflow: hidden` cannot cut it off.
 *
 * @param {React.ReactElement} props.trigger The element that opens the menu.
 * @param {{label: string, icon?, leading?: React.ReactNode, onClick?, isDivider?: boolean, isDanger?: boolean, color?: string, selected?: boolean, disabled?: boolean, disabledReason?: string}[]} props.items The rows; `selected` gives one a trailing tick instead of a "✓ " in its label, and `leading` carries what an icon cannot — a face, a status dot.
 * @param {(open: boolean) => void} props.onOpenChange Fires when the menu opens or closes.
 * @param {boolean} props.closeOnSelect Whether a click closes it; toggle menus keep it open while ticking.
 * @param {'start'|'end'} props.align Which edge the panel lines up with. `end` suits a kebab at the right of a row; `start` suits a trigger that sits at the left of one.
 * @param {string} props.dropdownClassName Placement of the panel only.
 * @param {string} props.className Placement of the trigger wrapper only.
 */
export default function ContextMenu({
  trigger, // React element that triggers the menu (e.g. Button)
  // Array of items: { label, icon, onClick, isDivider, isDanger, color, selected }
  // `selected` turns the row into a toggle: it stays open-menu styling but gets
  // a trailing checkmark instead of callers prefixing "✓ " into the label.
  items = [],
  className = '',
  dropdownClassName = '',
  align = 'end',
  onOpenChange, // Callback when open state changes
  closeOnSelect = true, // Toggle menus keep the panel open while ticking items
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const menuRef = useRef(null);
  const menuPosition = useFloatingOverlay({
    open: isOpen,
    anchorRef: containerRef,
    overlayRef: menuRef,
    preferredPlacement: 'bottom',
    align,
    gap: 4,
  });
  useFloatingOverlayEscape({ open: isOpen, onClose: () => setIsOpen(false) });

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // Only while open. A closed menu listening to the document is one wasted
  // listener per instance, which is invisible on a kebab and is the reason this
  // component could not be the control inside a table cell: a grid puts several
  // hundred of them on screen, and every click in the page then walks all of
  // them. `Popover` has always guarded it this way.
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickOutside = (event) => {
      if (
        containerRef.current
        && !containerRef.current.contains(event.target)
        && !menuRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleTriggerClick = (e) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
    if (trigger.props.onClick) {
      trigger.props.onClick(e);
    }
  };

  return (
    // `inline-block` put the trigger on a text baseline: the button kept its
    // own 20px height, but the wrapper around it grew by the line box's
    // descender space, so a kebab beside a plus in the same `items-center` row
    // sat a few pixels high. Callers worked around it by passing `flex`, which
    // collides with `inline-block` in the same Tailwind layer and wins or loses
    // by stylesheet order. A wrapper whose only job is to hold one control is
    // an inline flex box; there is no baseline to sit on.
    <div className={`relative inline-flex items-center ${isOpen ? 'z-50' : ''} ${className}`} ref={containerRef}>
      {React.cloneElement(trigger, {
        onClick: handleTriggerClick,
      })}

      {isOpen && typeof document !== 'undefined' && createPortal(
          <div
            ref={menuRef}
            data-qt-floating-overlay
            className={`fixed z-[1000] w-[200px] max-w-[calc(100vw-16px)] rounded-[12px] border border-line bg-white py-[6px] shadow-[0_8px_32px_rgba(0,0,0,0.12)] ${dropdownClassName}`}
            style={{
              top: menuPosition.top,
              left: menuPosition.left,
              visibility: menuPosition.ready ? 'visible' : 'hidden',
            }}
          >
            {items.map((item, idx) => {
              if (item.isDivider) {
                return <div key={`div-${idx}`} className="h-[1px] bg-canvas my-[4px] mx-[14px]" />;
              }

              const Icon = item.icon;
              const isDanger = item.isDanger || item.color === 'red' || item.color === '#ef4444';
              const isToggle = item.selected !== undefined;

              return (
                <button
                  key={item.label || idx}
                  type="button"
                  disabled={item.disabled}
                  title={item.disabled ? item.disabledReason : undefined}
                  role={isToggle ? 'menuitemcheckbox' : 'menuitem'}
                  aria-checked={isToggle ? Boolean(item.selected) : undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.disabled) return;
                    item.onClick?.(e);
                    if (closeOnSelect) setIsOpen(false);
                  }}
                  className={`w-full text-left px-[14px] py-[9px] text-[13px] flex items-center gap-[8px] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                    item.selected ? 'font-bold' : 'font-medium'
                  } ${
                    isDanger
                      ? 'text-danger hover:bg-danger-soft'
                      : 'text-ink hover:bg-canvas'
                  }`}
                  style={item.color && !isDanger ? { color: item.color } : {}}
                >
                  {/* A status is a colour, a person is a face, a priority is
                      its own mark. None of them is a lucide component, and a
                      menu that dropped them turned six distinguishable choices
                      into six lines of grey text. */}
                  {item.leading}
                  {Icon && (
                    <Icon
                      size={14}
                      className={isDanger ? 'text-danger' : 'text-muted'}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {isToggle && (
                    <Check
                      size={14}
                      strokeWidth={3}
                      className={`shrink-0 transition-opacity ${
                        item.selected ? 'text-ink opacity-100' : 'opacity-0'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
      )}
    </div>
  );
}
