// src/lib/utils/sidebarTheme.js
// Computes a full set of sidebar color tokens from a single background HEX color.
// Uses WCAG relative luminance to decide if the background is "dark" or "light",
// then derives text, muted, hover, active, and border colors accordingly.

// Bump whenever the ladder above changes.
//
// The rail is painted before React runs, by an inline script in app/layout.js
// reading the last theme this browser stored — that is what stops a branded
// workspace flashing dark on every load. It paints with `!important`, because
// it has to beat the inline style React is about to write.
//
// Which means a stored theme is a copy of this file's output, living in
// somebody's browser, that wins until React takes over. Change the numbers here
// and every existing browser keeps painting the old ones first — and on any
// load where the rail never mounts, keeps painting them for good. Stamping the
// version into the cache makes a change to this file invalidate every copy of
// it automatically, instead of relying on somebody thinking to clear their
// storage.
export const SIDEBAR_THEME_VERSION = 3;

export const SIDEBAR_PRESETS = {
  dark:  '#1f1f1f',
  light: '#ffffff',
};

/**
 * Parse a HEX color string into { r, g, b } (0-255).
 */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h;
  return {
    r: parseInt(full.substring(0, 2), 16),
    g: parseInt(full.substring(2, 4), 16),
    b: parseInt(full.substring(4, 6), 16),
  };
}

/**
 * WCAG relative luminance (0 = black, 1 = white).
 */
function luminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(first, second) {
  const firstLum = luminance(typeof first === 'string' ? hexToRgb(first) : first);
  const secondLum = luminance(typeof second === 'string' ? hexToRgb(second) : second);
  return (Math.max(firstLum, secondLum) + 0.05) / (Math.min(firstLum, secondLum) + 0.05);
}

/**
 * Clamp a value between 0 and 255.
 */
function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/**
 * Blend background and foreground colors by a given ratio (0 to 1).
 */
function blendColors(bg, fg, ratio) {
  return {
    r: Math.round(bg.r + (fg.r - bg.r) * ratio),
    g: Math.round(bg.g + (fg.g - bg.g) * ratio),
    b: Math.round(bg.b + (fg.b - bg.b) * ratio)
  };
}

// AA for body text. The rail's own words hold it, and the navigation holds it
// because the navigation was never what needed to move.
const READABLE_CONTRAST = 4.5;

// The project group: the «ПРОЄКТИ» header, the «+» beside it, the project rows
// with their icons, and the control that folds the rail away. One tier, because
// that is how it was asked for — one group that should stop competing with the
// navigation above it.
//
// 2.4:1 is well below anything WCAG asks of text, and that is the point: this
// group is not read, it is a list of names you already know, found by position
// and by icon. Every attempt to do this at an accessibility floor produced a
// change of nine to twenty points out of 255 — invisible on a screen — because
// on the dark preset those floors are already where this group was sitting.
// The number is low because the ask was «stop taking attention», and nothing
// higher delivers that.
const SCANNABLE_CONTRAST = 2.4;

// The rail's loudest ink. Pure white on a dark rail is the brightest a screen
// can be, and it is on the workspace name and the active item. Backed off a
// little; it keeps AA, and on a brand colour with no room it gets its white
// back, because `accessibleBlend` only ever raises.
const TEXT_BLEND = 0.88;

function accessibleBlend(bg, fg, preferredRatio, minimumContrast = READABLE_CONTRAST) {
  let ratio = preferredRatio;
  let blended = blendColors(bg, fg, ratio);
  while (ratio < 1 && contrastRatio(bg, blended) < minimumContrast) {
    ratio = Math.min(1, ratio + 0.01);
    blended = blendColors(bg, fg, ratio);
  }
  return blended;
}

function rgbToHex({ r, g, b }) {
  return '#' + [r, g, b].map(c => clamp(c).toString(16).padStart(2, '0')).join('');
}

/**
 * Compute a complete sidebar color theme from a single background color.
 *
 * Three tiers of quiet ink, and the floor each one answers to.
 *
 * The rail has a hierarchy: the navigation is the rail's job, the project list
 * is a second thing inside it, and the section header, the «+» beside it and
 * the collapse toggle are chrome around both. That is `muted` →
 * `mutedProject` → `mutedHeader`, each a notch quieter than the last.
 *
 * The notches were invisible for a long time, because `accessibleBlend` may
 * only ever raise a blend and all three answered to the same 4.5:1 floor. On
 * the dark preset that floor is roughly where the quietest tier wanted to be,
 * so the two below the navigation were clamped to it and to each other, and the
 * hierarchy existed only in the source.
 *
 * Raising the navigation to make room was the wrong half to move: it changed
 * the part of the rail nobody asked to change, and on a saturated brand colour
 * — where white itself barely clears 4.5:1 — there is no room above to move
 * into. The floor is what gives way instead, and only for the tiers that are
 * not prose. See `SCANNABLE_CONTRAST`.
 *
 * @param {string} bgHex - Background HEX color (e.g. '#1f1f1f')
 * @returns {{ bg, text, muted, mutedProject, mutedHeader, hover, active, border, isDark }}
 */
export function computeSidebarTheme(bgHex) {
  const fallback = bgHex && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(bgHex)
    ? bgHex
    : SIDEBAR_PRESETS.dark;

  const rgb = hexToRgb(fallback);
  const lum = luminance(rgb);
  let isDark = lum < 0.4; // Preserve the established dark/light preference.
  let textRgb = isDark ? { r: 255, g: 255, b: 255 } : { r: 31, g: 31, b: 31 };

  // A middle custom colour can make the preferred foreground fail AA. In that
  // narrow band, choose the stronger black/white candidate before deriving the
  // quieter tokens; no organization colour can create unreadable navigation.
  if (contrastRatio(rgb, textRgb) < 4.5) {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    textRgb = contrastRatio(rgb, white) >= contrastRatio(rgb, black) ? white : black;
    isDark = textRgb === white;
  }

  if (isDark) {
    // Dark background → light text
    return {
      bg: fallback,
      text: rgbToHex(accessibleBlend(rgb, textRgb, TEXT_BLEND)),
      muted: rgbToHex(accessibleBlend(rgb, textRgb, 0.50)),
      mutedProject: rgbToHex(accessibleBlend(rgb, textRgb, 0.26, SCANNABLE_CONTRAST)),
      mutedHeader: rgbToHex(accessibleBlend(rgb, textRgb, 0.22, SCANNABLE_CONTRAST)),
      hover: 'rgba(255,255,255,0.04)',
      active: 'rgba(255,255,255,0.08)',
      border: 'rgba(255,255,255,0.06)',
      isDark: true,
    };
  }

  // Light background → dark text
  return {
    bg: fallback,
    text: rgbToHex(accessibleBlend(rgb, textRgb, TEXT_BLEND)),
    muted: rgbToHex(accessibleBlend(rgb, textRgb, 0.50)),
    mutedProject: rgbToHex(accessibleBlend(rgb, textRgb, 0.26, SCANNABLE_CONTRAST)),
    mutedHeader: rgbToHex(accessibleBlend(rgb, textRgb, 0.22, SCANNABLE_CONTRAST)),
    hover: 'rgba(0,0,0,0.04)',
    active: 'rgba(0,0,0,0.06)',
    border: 'rgba(31,31,31,0.08)',
    isDark: false,
  };
}

/**
 * The colour a translucent surface actually shows: its own colour laid over
 * whatever is behind it at `alpha`.
 */
function compositeOver(frontHex, backdropHex, alpha) {
  return rgbToHex(blendColors(hexToRgb(backdropHex), hexToRgb(frontHex), alpha));
}

/**
 * The same theme, for a surface that is glass rather than paint.
 *
 * A translucent panel does not have the contrast its own colour promises. At
 * 88% over a white page the dark preset is *seen* as #353535, and `muted` —
 * derived to clear 4.5:1 against #1f1f1f — lands at 3.2:1 against what the
 * reader is actually looking at. So every token here is derived from the
 * perceived colour, and only `bg` stays the organization's own: that is the
 * colour being painted, at the returned `opacity`.
 *
 * Transparency is therefore a budget rather than a constant, and a brand colour
 * that cannot afford all of it gets less. A mid-tone blue thinned to 88% falls
 * into the band where black reads better than white, and the bar's labels would
 * have flipped colour while the sheet the same bar opens kept them white. The
 * tone is the organization's decision; the opacity is what gives way, one point
 * at a time, until the panel can carry that decision at AA.
 *
 * `over` is the page behind the surface. Below md the workspace shell and every
 * content pane are `--color-surface`, and the scrim under the bar keeps them so.
 *
 * @param {string} bgHex Background HEX colour of the surface itself.
 * @param {{opacity?: number, over?: string, minimumContrast?: number}} options Requested opacity, the page behind it, and the floor the text must hold.
 * @returns {{ bg, perceived, opacity, text, muted, hover, active, border, isDark }} `bg` is painted at `opacity`; `perceived` is what that produces, and the colour every token here answers to.
 */
export function computeTranslucentSidebarTheme(bgHex, {
  opacity = 0.88,
  over = '#ffffff',
  minimumContrast = 4.5,
} = {}) {
  const solid = computeSidebarTheme(bgHex);
  let alpha = opacity;
  let seen = compositeOver(solid.bg, over, alpha);
  let perceived = computeSidebarTheme(seen);

  while (
    alpha < 1
    && (perceived.isDark !== solid.isDark || contrastRatio(solid.text, seen) < minimumContrast)
  ) {
    alpha = Math.min(1, alpha + 0.01);
    seen = compositeOver(solid.bg, over, alpha);
    perceived = computeSidebarTheme(seen);
  }

  return { ...perceived, bg: solid.bg, perceived: seen, opacity: alpha };
}
