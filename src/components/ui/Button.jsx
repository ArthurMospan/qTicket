import React from 'react';

// ─── UI Kit: Master Button Component ─────────────────────────────────────────
// Single source of truth for ALL buttons in the project.
//
// SIZE RULES (strict):
//   size="lg"  → 36px (h-9)  — Primary CTA, default when no size specified
//   size="md"  → 32px (h-8)  — Action buttons (edit, archive, secondary)
//   size="sm"  → 28px (h-7)  — Small/compact contexts
//   size="icon"→ 32×32px     — Icon-only button (no text)
//   size="icon-xs" → 20×20px — Dense expand/action controls
//
// STYLE RULES (strict):
//   style="primary"   → dark background (#1f1f1f), white text
//   style="secondary" → light background (#f5f5f5), dark text
//   style="ghost"     → transparent bg, dark border + text
//
// COLOR EXCEPTIONS (only when explicitly needed):
//   color="red"   → red tones (delete/danger actions only)
//   color="dark"  → default (same as no color specified)

// Horizontal padding is not here. It is `--ui-control-px` in globals.css, next
// to the height it has to sit with — a utility written here would be emitted in
// Tailwind's last layer and beat every composition that tries to set padding,
// which is exactly how `invite-field` and `inline-edit` came to declare room
// they never got. The icon sizes keep `p-0`: a square has no padding to give.
export const SIZES = {
  sm:   'text-[12px]',
  md:   'text-[13px]',
  lg:   'text-[13px]',
  icon: 'w-[32px] p-0',
  'icon-xl': 'w-[56px] p-0',
  'icon-lg': 'w-[36px] p-0',
  'icon-sm': 'w-[28px] p-0',
  'icon-xs': 'w-[20px] p-0',
  'icon-24': 'w-[24px] p-0',
  'icon-30': 'w-[30px] p-0',
};

// Icon size per button size — the single place that decides it.
//
// This replaced `size === 'lg' ? 16 : size === 'sm' ? 12 : 14`, which predated
// the icon-* scale and handed the same 14px icon to a 20px box and a 36px box
// alike. Call sites patched around it with an `iconSize` prop, which meant 39
// places each held their own copy of a decision that belongs here — changing
// the icon scale could not propagate while that prop existed.
//
// ── Every number here is even, and that is a rule ───────────────────────────
// An icon button centres its glyph with flexbox, so the gap on each side is
// `(box - icon) / 2`. Every box in `SIZES` is an even number of pixels, so an
// **odd** icon size puts the glyph on a half-pixel — and a half-pixel offset is
// not a rounding curiosity, it is a visibly crooked button: the browser has to
// pick a side for the sub-pixel, it picks a different one at every zoom level,
// and a stroked glyph antialiases asymmetrically across the boundary.
//
// That is exactly what the board column's kebab did. It was 13px in a 20px box
// — a 3.5px gap — while the plus right beside it was 16px in the same box, a
// clean 2px. One looked centred and the other did not, and which way the kebab
// leaned changed as you zoomed, because 3.5 CSS pixels is 4.375 device pixels
// at 125% and a whole 7 at 200%.
//
// Eight of these numbers were odd. `tests/kit-icon-alignment.test.mjs` keeps
// them even, so the next icon size cannot reintroduce it.
export const ICON_SIZES = {
  sm: 12,
  md: 14,
  lg: 16,
  icon: 14,        // 32px box
  'icon-xl': 22,   // 56px box — the profile action circles
  'icon-lg': 14,   // 36px box
  'icon-sm': 14,   // 28px box
  'icon-xs': 16,   // 20px box
  'icon-24': 14,
  'icon-30': 14,
};

// A composition may legitimately want a different icon than its size implies.
// Naming it keeps the intent in the kit; `settings-row-action` is the ghost
// "add row" button, which reads better with an icon smaller than its lg box.
// Same rule as `ICON_SIZES`: even numbers only, because every box is even and a
// half-pixel gap is a crooked button. Six of these were odd.
export const COMPOSITION_ICON_SIZES = {
  'settings-row-action': 12,
  'sidebar-help-action': 16,

  // The section kebab, beside a plus in the same 20px box. Three filled dots
  // and two hairline strokes are not the same amount of ink at the same pixel
  // size: at 16 the kebab read as the darker of the two, so it is set smaller
  // than the plus — 14, the nearest even step, which keeps that relationship
  // and lands the glyph on a whole 3px gap instead of 3.5.
  'section-kebab': 14,

  // Chat-only icon sizes. The generic size scale gives a 20px box a 16px icon,
  // which is right for dense toolbars and wrong for a chat message action —
  // those were 12px and jumped by four when the free `iconSize` prop went away.
  'chat-message-action': 14,
  'chat-composer-action': 16,
  'chat-panel-action': 16,
  'chat-micro-action': 12,
  'chat-composer-cancel': 12,
  // The auth shell's close button. Named rather than migrated: login and
  // onboarding are out of scope for kit changes, so this keeps that screen
  // pixel-identical while still holding the number here instead of there.
  'auth-close': 16,
};

const UI_SIZES = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
  icon: 'md',
  'icon-xl': 'icon-56',
  'icon-lg': 'lg',
  'icon-sm': 'sm',
  'icon-xs': 'icon-xs',
  'icon-24': 'icon-24',
  'icon-30': 'icon-30',
};

export const SHAPES = {
  default: '',
  compact: '!rounded-[8px]',
  micro: '!rounded-[6px]',
  tight: '!rounded-[7px]',
  circle: '!rounded-full',
};

export const SURFACES = {
  default: '',
  canvas: '!bg-canvas !text-ink hover:!bg-line',
  'danger-subtle': '!border !border-danger !bg-danger-soft hover:!bg-danger-soft',
};

// collapseAt="sm"|"md": below that breakpoint the label hides and the button
// becomes a square icon button — one Button instead of a hand-rolled pair.
// NOTE: these use max-* responsive variants on purpose — a plain `hidden` in
// className can NOT override the base `inline-flex` (same-layer utilities,
// stylesheet order wins), while responsive variants always can.
const COLLAPSE_BTN = {
  sm: {
    sm: 'max-sm:w-[28px] max-sm:px-0 max-sm:gap-0',
    md: 'max-sm:w-[32px] max-sm:px-0 max-sm:gap-0',
    lg: 'max-sm:w-[36px] max-sm:px-0 max-sm:gap-0',
  },
  md: {
    sm: 'max-md:w-[28px] max-md:px-0 max-md:gap-0',
    md: 'max-md:w-[32px] max-md:px-0 max-md:gap-0',
    lg: 'max-md:w-[36px] max-md:px-0 max-md:gap-0',
  },
};
const COLLAPSE_LABEL = { sm: 'max-sm:hidden', md: 'max-md:hidden' };

export const STYLES = {
  primary: {
    dark: 'bg-ink text-white hover:bg-ink-hover',
    red:  'bg-danger-solid text-white hover:bg-danger',
  },
  secondary: {
    dark: 'bg-canvas text-ink hover:bg-line',
    red:  'bg-canvas text-danger hover:bg-line',
  },
  outline: {
    dark: 'bg-transparent text-ink border-2 border-ink hover:bg-canvas',
    red:  'bg-transparent text-danger border-2 border-danger hover:bg-danger-soft',
  },
  ghost: {
    dark: 'bg-transparent text-muted hover:text-ink hover:bg-canvas',
    red:  'bg-transparent text-danger hover:bg-danger-soft',
  },
};

/**
 * The kit's button. Its height, line box and radius come from `.ui-control` in
 * `globals.css`, not from here and never from a call site — that is what keeps
 * one height change reaching every screen.
 *
 * @param {React.ReactNode} props.children Label.
 * @param {'primary'|'secondary'|'outline'|'ghost'} props.style Weight of the button in its context.
 * @param {'dark'|'red'} props.color Semantic colour; `red` means destructive.
 * @param {'sm'|'md'|'lg'|'icon'|string} props.size Control height token; the icon sizes are square boxes.
 * @param {React.ComponentType} props.icon Leading lucide icon. Its pixel size is derived from `size`.
 * @param {boolean} props.disabled Unavailable: dimmed, not clickable, still readable.
 * @param {boolean} props.loading Busy: swaps the icon for a spinner and blocks the click.
 * @param {(event) => void} props.onClick Click handler.
 * @param {'button'|'submit'|'reset'} props.type Native button type.
 * @param {string} props.shape Corner radius token.
 * @param {string} props.surface Which background the button sits on, where that changes its contrast.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {number} props.collapseAt Viewport width below which the label is hidden and only the icon remains.
 * @param {React.Ref} props.buttonRef Ref to the underlying button, for popovers anchored to it.
 * @param {string} props.variant Legacy alias for `style`, kept for existing call sites.
 * @param {string} props.className Placement in the parent only — never its own height, padding or type.
 */
export function Button({
  children,
  style    = 'primary',  // 'primary' | 'secondary' | 'outline' | 'ghost'
  color    = 'dark',     // 'dark' | 'red'
  size     = 'lg',       // 'sm' | 'md' | 'lg' | 'icon'
  icon: Icon,
  buttonRef,
  disabled  = false,
  loading   = false,
  onClick,
  type      = 'button',
  className = '',
  collapseAt,
  composition,
  shape = 'default',
  surface = 'default',
  // Legacy prop support
  variant,
  ...props
}) {
  // Legacy variant prop support
  const effectiveStyle = variant || style;
  // Validate color — only 'dark' and 'red' are supported
  const effectiveColor = color === 'red' ? 'red' : 'dark';

  // The line box is control geometry and belongs to `.ui-control` in
  // globals.css, next to the height it has to match. A line-height utility here
  // beats the components layer, and the one that used to sit in `baseClasses`
  // made the line box exactly one font-size tall — which left every label about
  // two pixels above the middle of its button.
  const baseClasses =
    'inline-flex items-center justify-center gap-[6px] font-bold transition-colors ' +
    'disabled:opacity-50 disabled:cursor-not-allowed shrink-0';

  const sizeClass  = SIZES[size] ?? SIZES.lg;
  const collapseClass = collapseAt ? (COLLAPSE_BTN[collapseAt]?.[size] ?? '') : '';
  const labelCollapseClass = collapseAt ? (COLLAPSE_LABEL[collapseAt] ?? '') : '';
  const styleClass = STYLES[effectiveStyle]?.[effectiveColor] ?? STYLES.primary.dark;
  const finalIconSize = COMPOSITION_ICON_SIZES[composition] ?? ICON_SIZES[size] ?? ICON_SIZES.lg;

  return (
    <button
      ref={buttonRef}
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      data-ui-size={UI_SIZES[size] ?? 'lg'}
      data-ui-composition={composition}
      className={`ui-control ui-button ${baseClasses} ${sizeClass} ${collapseClass} ${styleClass} ${SHAPES[shape] ?? ''} ${SURFACES[surface] ?? ''} ${className}`}
      {...props}
    >
      {loading ? (
        <svg
          className="animate-spin h-4 w-4"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        <>
          {Icon && <Icon size={finalIconSize} />}
          {children && (
            <span className={size.startsWith('icon') ? 'sr-only' : labelCollapseClass}>{children}</span>
          )}
        </>
      )}
    </button>
  );
}

export default Button;
