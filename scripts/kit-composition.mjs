// scripts/kit-composition.mjs — the named size contracts, as declared.
//
// The kit writes composition geometry in `globals.css` under `@layer components`
// and means it to be the one place that geometry lives. Half of what those rules
// declared never reached the screen, and nothing said so.
//
// The reason is cascade layers, not specificity. `.ui-control[data-ui-composition=…]`
// is a class plus an attribute — 0,2,0 — and beats `.px-4` at 0,1,0 easily. But
// Tailwind emits `@layer theme, base, components, utilities;`, and **layer order
// wins over specificity**: a utility in the last layer beats any rule in an
// earlier one. The moment `Button` writes `px-4` in its own class list, every
// `padding` a composition declares for it is dead — silently, with the rule
// still in the file looking like the source of truth.
//
// Custom properties are the exception, which is why `--ui-control-height` is
// the one part of these presets that always worked: no utility sets it.
//
// This module only *enumerates* what the stylesheet declares, which is exact.
// Whether a declaration survives the cascade is decided in a browser, by
// tests/visual/ui-kit.spec.mjs — the first version of this file guessed at it
// from a table of utility prefixes and was wrong twice in one session:
//
//   • it matched quotes with a regex, so an apostrophe in a comment ("the
//     component's own height") opened a string that swallowed the class lists
//     after it. Adding JSDoc to Button made every `bg-*` utility vanish from
//     the token set, and the report changed without the code changing.
//   • it could not tell an unconditional utility from a variant or a branch.
//     `hover:bg-canvas` shadows nothing at rest; `bg-red-50` shadows only a
//     field in error. Both were counted, and the culprit named was often not
//     the one that actually wins.
//
// `getComputedStyle` has neither problem: it reports what the browser resolved.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLOBALS = join(ROOT, 'src', 'app', 'globals.css');

/**
 * Every `data-ui-*` rule inside `@layer components`, with the properties it
 * declares. Custom properties are excluded: no utility can shadow one, so they
 * are never part of the question.
 *
 * @param {string} css Stylesheet source; defaults to src/app/globals.css.
 * @returns {{selector: string, declarations: {property: string, value: string}[]}[]}
 */
export function layeredCompositionRules(css = readFileSync(GLOBALS, 'utf8')) {
  // Comments go before anything counts a brace. Both passes below are brace
  // arithmetic — the depth scan that finds the end of the layer, and the split
  // that separates a selector from its block — and prose is allowed to contain
  // a brace. It does: the comment above `attribute-field` quotes a call site
  // (`inputClassName={compactInputClass}`), so it split itself across two
  // matches and the half after the brace arrived glued to the front of the next
  // selector, which `querySelectorAll` then rejected outright. Stripping
  // per-selector, as this did, cannot fix that: by then the `/*` and the `*/`
  // are in different strings. This is the second time punctuation inside a
  // comment has moved this module's output without the code changing; the first
  // is the apostrophe in the header.
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');

  const start = source.indexOf('@layer components');
  if (start < 0) return [];

  let depth = 0;
  let index = source.indexOf('{', start);
  const open = index;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = source.slice(open + 1, index);

  const rules = [];
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1].trim();
    if (!/\[data-ui-/.test(selector)) continue;
    if (/:hover|:focus|::/.test(selector)) continue;

    const declarations = [];
    for (const declaration of match[2].split(';')) {
      const [property, ...rest] = declaration.split(':');
      const name = property.trim();
      if (!name || name.startsWith('--')) continue;
      declarations.push({ property: name, value: rest.join(':').trim() });
    }
    if (declarations.length) rules.push({ selector, declarations });
  }
  return rules;
}
