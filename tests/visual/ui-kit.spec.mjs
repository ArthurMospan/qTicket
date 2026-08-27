// tests/visual/ui-kit.spec.mjs — one screenshot per /ui-kit section.
//
// The three generated reports answer "does the product use the kit, with the
// values the kit declares". None of them can see that a control moved four
// pixels or lost its border. This suite is that missing sense: it photographs
// every section and fails on the difference, with expected/actual/diff PNGs in
// the CI artifact.
//
// Every section is captured at rest, and exactly one — «Матриця станів» — is
// captured a second time with its hover and focus cells forced. Mixing the
// pointer into the other baselines would mean each of them encoded an
// arbitrary cursor position; keeping it to the section built for it means the
// two pseudo-classes are photographed without any baseline having to guess.
import { test, expect } from '@playwright/test';
import { SECTIONS, FORCED_STATE_SECTION } from './sections.mjs';
import { openSection } from './hydration.mjs';
import { layeredCompositionRules } from '../../scripts/kit-composition.mjs';
import kitDrift from '../../src/app/ui-kit/kit-drift.generated.json' with { type: 'json' };

// A fixed instant, so relative timestamps in the chat and task demos render the
// same string forever. The demos read the clock while their module evaluates,
// which is why this is an init script rather than a call after navigation.
const FROZEN_TIME = Date.UTC(2026, 6, 12, 9, 0, 0);

// Chromium cannot capture past 16384px in either dimension. The variant matrix
// renders every declared value of every component and needs ~15300 of them, so
// the ceiling sits just under the hard limit — and a section that outgrows it
// fails loudly instead of quietly photographing half of itself.
const MAX_SHOT_HEIGHT = 16_000;

// `next dev` keeps a hot-reload socket open that the test browser has no use
// for and that fails its handshake on every load. It is the dev server talking
// about itself, not the catalogue rendering badly.
const DEV_SERVER_NOISE = /webpack-hmr|WebSocket connection to 'ws:/;

let consoleErrors = [];
let widgetRequests = 0;

test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  widgetRequests = 0;
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (!DEV_SERVER_NOISE.test(text)) consoleErrors.push(text);
  });
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));

  // Freeze wall-clock reads without faking timers: requestAnimationFrame and
  // setTimeout stay real, so React, transitions and the waits below still run.
  await page.addInitScript(fixed => {
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(fixed);
        else super(...args);
      }
      static now() { return fixed; }
    }
    window.Date = FrozenDate;
  }, FROZEN_TIME);

  // The bug-reporter widget in the root layout is third-party furniture that
  // floats above the page. Served empty rather than aborted, so the block does
  // not itself become the console error this suite asserts against.
  await page.route(
    url => url.hostname === 'buggy-bag.vercel.app',
    route => {
      widgetRequests += 1;
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
    },
  );
  await page.goto('/ui-kit', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-kit-scroll]');
  // The dev build paints its own indicator in the corner of every page.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await settle(page);
});

test.afterEach(() => {
  expect(consoleErrors, 'the catalogue must render without console errors').toEqual([]);
});

// Fonts arrive from Google Fonts, so a screenshot taken before they land would
// bake the fallback metrics into the baseline.
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter(image => !image.complete)
        .map(image => image.decode().catch(() => {})),
    );
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

// The catalogue scrolls inside a flex child, not the window, so `fullPage` sees
// only the visible slice. Growing the viewport to the content height is what
// puts the whole section in one frame — and it does it without overriding the
// page's own overflow, which would change the very layout under test.
async function showSection(page, id) {
  const scroller = await openSection(page, id);

  // A clicked nav button keeps focus, and the pointer would otherwise rest
  // wherever the click landed — both are visible states.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.mouse.move(0, 0);
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await settle(page);

  // Growing the viewport can reflow the content taller (wrapped rows unwrap,
  // sticky elements settle), so measure again until it stops overflowing.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const overflow = await scroller.evaluate(el => Math.ceil(el.scrollHeight - el.clientHeight));
    if (overflow <= 0) break;
    const viewport = page.viewportSize();
    const height = Math.min(viewport.height + overflow, MAX_SHOT_HEIGHT);
    if (height === viewport.height) break;
    await page.setViewportSize({ width: viewport.width, height });
    await settle(page);
  }

  const remaining = await scroller.evaluate(el => Math.ceil(el.scrollHeight - el.clientHeight));
  expect(remaining, `section "${id}" does not fit in ${MAX_SHOT_HEIGHT}px`).toBeLessThanOrEqual(0);
  return scroller;
}

// A section added to GROUPS without a baseline would otherwise be covered by
// nothing at all, which is the failure mode this whole suite exists to prevent.
test('the navigation lists exactly the sections this suite covers', async ({ page }) => {
  const ids = await page
    .locator('[data-kit-nav]')
    .evaluateAll(elements => elements.map(element => element.dataset.kitNav));
  expect(ids).toEqual(SECTIONS.map(section => section.id));
});

// Both of these are silent when they break: a live clock would only show up as
// a chat timestamp that drifts by a minute between two baseline runs, and a
// missed interception as a third-party widget that appears in some screenshots
// and not others.
test('the page is photographed against a frozen clock and without the widget', async ({ page }) => {
  expect(await page.evaluate(() => Date.now()), 'the page clock is frozen').toBe(FROZEN_TIME);
  expect(await page.evaluate(() => new Date().getTime())).toBe(FROZEN_TIME);
  expect(widgetRequests, 'the bug-reporter script is intercepted').toBeGreaterThan(0);
});

test('every catalogue section fits a phone viewport without page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const sectionSelect = page.locator('select[aria-label="Секція UI Kit"]');
  const scroller = page.locator('[data-kit-scroll]');

  for (const section of SECTIONS) {
    await sectionSelect.selectOption(section.id);
    await expect(scroller).toHaveAttribute('data-kit-section', section.id);
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await settle(page);

    const widths = await page.evaluate(() => {
      const content = document.querySelector('[data-kit-scroll]');
      return {
        pageClient: document.documentElement.clientWidth,
        pageScroll: document.documentElement.scrollWidth,
        contentClient: content?.clientWidth || 0,
        contentScroll: content?.scrollWidth || 0,
      };
    });

    expect(widths.pageScroll, `${section.id}: page overflow`).toBeLessThanOrEqual(widths.pageClient + 1);
    expect(widths.contentScroll, `${section.id}: catalogue content overflow`).toBeLessThanOrEqual(widths.contentClient + 1);
  }
});

for (const section of SECTIONS) {
  test(`${section.id} — ${section.label}`, async ({ page }) => {
    const scroller = await showSection(page, section.id);
    await expect(scroller).toHaveScreenshot(`${section.id}.png`);
  });
}

// Does every named size contract actually reach the screen?
//
// `@layer components` loses to Tailwind's utility layer regardless of
// specificity, so a `padding` a composition declares for a control that writes
// its own `px-*` is dead — still in the file, still reading as the source of
// truth. Fifty declarations were in that state before anything measured it.
//
// Measured rather than inferred. A static version of this check guessed from a
// table of utility prefixes and was wrong twice: it desynced on an apostrophe
// inside a comment, and it could not tell `hover:bg-canvas` or an error-branch
// `bg-red-50` from a utility that always applies. `getComputedStyle` has
// neither problem — it reports what the browser resolved.
//
// «Матриця варіантів» renders every declared composition, which is what makes
// one page enough to check them all.
test('every data-ui-* declaration survives the cascade', async ({ page }) => {
  await showSection(page, 'variant-matrix');

  // `.ui-control[data-ui-composition]` is one selector shared by Button and
  // Input, and the matrix renders every declared value on both. A composition
  // the product only ever puts on a field would otherwise be judged on a
  // 32px icon button that never carries it — so each rule is measured on the
  // element its owner really renders.
  const OWNER_TAGS = {
    Button: 'button', IconAction: 'button', Input: 'input', Textarea: 'textarea',
    Segmented: 'div', Surface: 'div', Card: 'div', ChatComposerDock: 'div',
  };
  const owners = {};
  for (const key of Object.keys(kitDrift.usage)) {
    const match = key.match(/^(\w+)\.composition\.(.+)$/);
    if (!match || !OWNER_TAGS[match[1]]) continue;
    (owners[match[2]] = owners[match[2]] || new Set()).add(OWNER_TAGS[match[1]]);
  }

  // Compositions only. `data-ui-surface`, `data-ui-padding` and the pill
  // attributes are families whose rules deliberately override one another
  // inside the same layer — a later sibling winning there is the design, not a
  // utility beating the kit, and this test would read the two as the same.
  const rules = layeredCompositionRules()
    .filter(rule => /data-ui-composition/.test(rule.selector))
    .map(rule => {
      const values = [...rule.selector.matchAll(/data-ui-composition='([^']+)'/g)].map(m => m[1]);
      const tags = [...new Set(values.flatMap(value => [...(owners[value] || [])]))];
      return { selector: rule.selector, declarations: rule.declarations, tags };
    });

  const { dead, unrendered, checked } = await page.evaluate(rules => {
    // Longhands of a shorthand the rule sets, and the keyword spellings the
    // browser normalises to. Comparing `padding: 6px 10px` against a computed
    // string would fail on formatting alone, so shorthands are expanded.
    const EXPAND = {
      padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
      'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
      gap: ['row-gap', 'column-gap'],
    };

    const dead = [];
    const unrendered = [];
    let checked = 0;

    for (const rule of rules) {
      const all = [...document.querySelectorAll(rule.selector)];
      const elements = rule.tags.length ? all.filter(el => rule.tags.includes(el.tagName.toLowerCase())) : all;
      if (elements.length === 0) {
        unrendered.push(rule.selector);
        continue;
      }
      for (const element of elements) {
        const computed = getComputedStyle(element);
        for (const { property, value } of rule.declarations) {
          if (!value || value.includes('var(')) continue;      // resolved elsewhere
          // Only absolute values can be compared as text. A percentage, a
          // viewport unit or `auto` is resolved against a parent the catalogue
          // chooses, so a mismatch would say something about the preview, not
          // about the cascade.
          if (/%|vh|vw|calc\(|^auto$|^none$/.test(value)) continue;
          // `background` and `border` resolve to a compound string no textual
          // comparison survives. A rule that means one of them writes the
          // longhand — `background-color`, `border-color` — which does compare.
          if (property === 'background' || property === 'border' || property === 'font') continue;
          const properties = EXPAND[property] || [property];
          const wanted = EXPAND[property] ? value.split(/\s+/) : [value];
          for (let index = 0; index < properties.length; index += 1) {
            const want = wanted[Math.min(index, wanted.length - 1)];
            const actual = computed.getPropertyValue(properties[index]).trim();
            checked += 1;
            if (actual === want) continue;
            // `0` and `0px` are the same length spelled two ways.
            if (parseFloat(actual) === parseFloat(want) && /^-?[\d.]+/.test(want)) continue;
            if (/px$/.test(want) && Math.abs(parseFloat(actual) - parseFloat(want)) < 0.6) continue;
            dead.push({
              selector: rule.selector,
              property: properties[index],
              want,
              got: actual,
              tag: element.tagName.toLowerCase(),
            });
          }
        }
      }
    }
    return { dead, unrendered, checked };
  }, rules);

  // Small on purpose: after the cleanup most compositions carry only custom
  // properties, which no utility can shadow and which are therefore never part
  // of this question. What is left is the handful that still declare concrete
  // geometry — and the guard is that the number does not quietly reach zero,
  // which would mean the check had stopped looking at anything.
  //
  // Lowered 20 → 15 when `menu-item` was deleted. It was one of the few
  // compositions declaring concrete geometry (`width: 100%`, `border-radius: 0`)
  // across three owner tags, so it was carrying a good share of this count on
  // its own. Removing the rule that dressed a Button as a menu row is the point,
  // not a regression in coverage.
  expect(checked, 'the matrix must render the compositions this reads').toBeGreaterThan(15);
  expect(
    dead,
    'a declaration that cannot reach the screen must be removed, or the utility that beats it must go',
  ).toEqual([]);
  // Not a failure: a composition with no standalone example simply cannot be
  // checked here. Printed so the number stays visible instead of drifting.
  console.log(`compositions with no element on /ui-kit: ${unrendered.length}`);
});

// A pseudo-class has no DOM. Only one element can really be hovered and only
// one can hold focus, so a single frame showing thirty hovered controls is not
// something the page can be asked to produce — it has to be forced.
//
// `CSS.forcePseudoState` is the honest way to force it: it makes the browser
// match the component's own `:hover` and `:focus-visible` rules, so nothing in
// the catalogue has to carry a second, static copy of its hover styling. The
// force is applied to the whole subtree of a state cell, because `group-hover:`
// reads the pointer on an ancestor and `peer-focus-visible:` on a sibling.
test('states — hover and focus, forced', async ({ page }) => {
  const scroller = await showSection(page, FORCED_STATE_SECTION);

  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: false });

  const forced = { hover: ['hover'], focus: ['focus', 'focus-visible'] };
  let cells = 0;
  for (const [state, pseudoClasses] of Object.entries(forced)) {
    const { nodeIds } = await client.send('DOM.querySelectorAll', {
      nodeId: root.nodeId,
      selector: `[data-kit-state="${state}"], [data-kit-state="${state}"] *`,
    });
    cells += nodeIds.length;
    for (const nodeId of nodeIds) {
      await client.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: pseudoClasses });
    }
  }
  // A selector that silently matches nothing would photograph the resting state
  // under a name that promises otherwise, and the baseline would lock it in.
  expect(cells, 'the state matrix must expose hover and focus cells to force').toBeGreaterThan(20);

  await settle(page);
  await expect(scroller).toHaveScreenshot('states-forced.png');
});
