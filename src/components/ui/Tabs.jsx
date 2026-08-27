'use client';
import Link from 'next/link';
import Counter from './DataDisplay/Counter';

// ─── UI Kit: Tabs Component ───────────────────────────────────────────────────
// Height rule: h-[36px] — matches inputs and buttons for perfect alignment.
// Wrapper: bg-canvas rounded-[10px] p-[4px] h-[36px]

// Two shapes, because the product genuinely has two and neither is a size of
// the other. `raised` is the pill strip that sits in a filter row and lines up
// with inputs at 36px. `underline` is the wide stepper across the top of a
// stage — it fills its container, so its tabs stretch, and the selected one is
// marked by a rule under it rather than by a lifted tile. A rule reads as
// "you are here in a sequence"; a tile reads as "this is switched on".
const SHAPES = {
  raised: {
    strip: 'flex bg-canvas h-[36px] p-[4px] rounded-[10px] items-center gap-[2px] shrink-0',
    tab: 'h-[28px] rounded-[8px] text-[13px] font-medium',
    labelled: 'px-[16px]',
    iconOnly: 'w-[28px] shrink-0',
    on: 'bg-white text-ink shadow-sm',
    off: 'text-muted hover:text-ink',
  },
  underline: {
    strip: 'flex w-full min-w-max items-center border-b border-line',
    // `-mb-px` is what makes the selected rule land *on* the strip's hairline
    // rather than a pixel above it. Without it the two lines stack — a black
    // mark floating over an unbroken grey one — instead of the black one
    // replacing the grey for the width of the tab you are standing on.
    tab: '-mb-px min-w-[140px] flex-1 whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-[13px]',
    labelled: '',
    iconOnly: '',
    on: 'border-ink font-semibold text-ink',
    off: 'border-transparent text-muted hover:text-ink',
  },
};

/**
 * Horizontal tab strip. The `raised` shape is 36px tall so it lines up with
 * inputs and buttons in the same row; the `underline` shape spans its container
 * as a stepper. Arrow keys move between tabs, as the ARIA tab pattern requires.
 *
 * @param {{id: string, label: string, href?: string, icon?, count?: number, disabled?: boolean, title?: string, ariaLabel?: string}[]} props.tabs The tabs; `href` turns one into a link.
 * @param {string} props.activeTab Id of the selected tab.
 * @param {(id: string) => void} props.onTabChange Fires with the newly selected tab id.
 * @param {'raised'|'underline'} props.variant Which of the two strips to draw.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {string} props.className Placement in the parent only.
 */
export default function Tabs({
  tabs      = [],
  activeTab,
  onTabChange,
  variant   = 'raised',
  composition,
  className = '',
}) {
  const shape = SHAPES[variant] ?? SHAPES.raised;
  if (!tabs || tabs.length === 0) return null;

  const handleKeyDown = (e) => {
    const tabElements = Array.from(e.currentTarget.querySelectorAll('[role="tab"]'));
    const currentIndex = tabElements.indexOf(document.activeElement);
    if (currentIndex === -1) return;

    let nextIndex = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % tabElements.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + tabElements.length) % tabElements.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      nextIndex = tabElements.length - 1;
    }

    if (nextIndex !== null) {
      tabElements[nextIndex].focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label="Перемикач вкладок"
      onKeyDown={handleKeyDown}
      data-ui-composition={composition}
      className={`ui-tabs ${shape.strip} ${className}`}
    >
      {tabs.map(tab => {
        const Icon   = tab.icon;
        const active = activeTab === tab.id;

        const content = (
          <>
            {Icon && <Icon size={14} />}
            {tab.label}
            {Number(tab.count) > 0 && (
              <Counter
                value={tab.count}
                size="sm"
                appearance={active ? 'solid' : 'subtle'}
              />
            )}
          </>
        );

        const classes = [
          'flex items-center justify-center gap-[6px]',
          tab.label ? shape.labelled : shape.iconOnly,
          shape.tab,
          'transition-all whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2',
          active ? shape.on : shape.off,
          tab.disabled ? 'cursor-not-allowed opacity-40' : '',
        ].join(' ');

        if (tab.href) {
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={classes}
              role="tab"
              aria-selected={active}
              aria-label={tab.ariaLabel || tab.title || undefined}
              title={tab.title}
              tabIndex={active ? 0 : -1}
            >
              {content}
            </Link>
          );
        }

        return (
          <button
            type="button"
            key={tab.id}
            onClick={() => !tab.disabled && onTabChange?.(tab.id)}
            disabled={tab.disabled}
            title={tab.title}
            aria-label={tab.ariaLabel || tab.title || undefined}
            className={classes}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
