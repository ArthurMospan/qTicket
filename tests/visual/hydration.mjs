import { expect } from '@playwright/test';

// Switching a section of /ui-kit, on a page that may not be alive yet.
//
// The catalogue is server-rendered: the first section, its navigation and the
// mobile picker all arrive in the HTML, and every one of them is inert until
// React has hydrated. So an action that lands in that window does nothing at
// all — no error, no trace, and no way to tell it apart from a broken handler.
// A dev server compiling a three-thousand-line client page on a cold runner
// makes that window wide enough to hit.
//
// There is no earlier signal that a handler is attached, so the honest wait is
// to keep performing the action until the page reacts to it. `ui-kit.spec.mjs`
// learned this once; `public-flows.spec.mjs` did not, and lost a run to it.
// Hence one place.
const SECTION_SELECT = 'select[aria-label="Секція UI Kit"]';

/**
 * @param via `'nav'` for the rail on a wide viewport, `'select'` for the
 *   picker that replaces it on a phone. They are two controls for one state,
 *   and both are inert before hydration.
 */
export async function openSection(page, id, { via = 'nav' } = {}) {
  const scroller = page.locator('[data-kit-scroll]');
  await scroller.waitFor();
  await expect(async () => {
    if (via === 'select') {
      await page.locator(SECTION_SELECT).selectOption(id);
    } else {
      await page.locator(`[data-kit-nav="${id}"]`).click();
    }
    await expect(scroller).toHaveAttribute('data-kit-section', id, { timeout: 1_000 });
  }).toPass({ timeout: 45_000 });
  return scroller;
}
