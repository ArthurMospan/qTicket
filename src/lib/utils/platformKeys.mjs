// src/lib/utils/platformKeys.mjs
// Which modifier key this keyboard actually has.
//
// The palette has always answered to both ⌘K and Ctrl+K — `CommandPalette`
// checks `metaKey || ctrlKey` — but every label in the product said ⌘K, which
// is a Mac key that most of the team does not have. A hint that names a key the
// reader cannot find is worse than no hint: it reads as "this is not for you".
//
// Pure, so the mapping can be asserted without a browser; the hook beside it
// only supplies the platform string.

// `navigator.platform` is deprecated but still the most reliable of the three,
// and `userAgentData.platform` is Chromium-only, so both are read.
const APPLE = /mac|iphone|ipad|ipod/i;

/**
 * Whether this is an Apple keyboard — the only one with a ⌘ key.
 * Unknown platforms answer `false`: Ctrl is the safer thing to name, because a
 * Mac user pressing Ctrl+K still opens the palette, and a Windows user hunting
 * for ⌘ finds nothing at all.
 */
export function isApplePlatform(platform) {
  return APPLE.test(String(platform || ''));
}

/** What to call the palette's modifier on this keyboard. */
export function commandKeyLabel(apple) {
  return apple ? '⌘' : 'Ctrl';
}

/**
 * The palette hint as one string. Apple keeps the tight `⌘K` its own OS uses;
 * everywhere else the two need a space, or `CtrlK` reads as one word.
 */
export function paletteShortcutLabel(apple) {
  return apple ? '⌘K' : 'Ctrl K';
}
