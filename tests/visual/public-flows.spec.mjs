import { test, expect } from '@playwright/test';
import { searchHelpArticles } from '../../src/lib/content/helpArticles.mjs';
import { openSection } from './hydration.mjs';

const DEV_SERVER_NOISE = /webpack-hmr|WebSocket connection to 'ws:/;

// The search assertion below used to spell out a query and an article title as
// literals, and both went stale the moment the help was rewritten for readers:
// the title it waited for no longer existed, so the run spent 45 seconds
// retrying a phrase nothing could match. The query still has to be written by
// hand — only a person can pick one worth typing — but what it must find comes
// from the same function the page searches with, so a rewritten article moves
// the expectation with it.
const HELP_QUERY = 'багато завдань';

async function preparePage(page) {
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error' && !DEV_SERVER_NOISE.test(message.text())) {
      errors.push(message.text());
    }
  });
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  await page.route('https://buggy-bag.vercel.app/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '',
  }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: '',
  }));
  return errors;
}

async function expectHealthyPage(page, errors, ignored = []) {
  await expect(page.locator('body')).not.toHaveText('');
  await expect(page.locator('[data-nextjs-dialog], #webpack-dev-server-client-overlay')).toHaveCount(0);
  expect(errors.filter(error => !ignored.some(pattern => pattern.test(error)))).toEqual([]);
}

test('public routes, redirects and security headers form one coherent entry flow', async ({ page }) => {
  const errors = await preparePage(page);

  const loginResponse = await page.goto('/login', { waitUntil: 'domcontentloaded' });
  expect(loginResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Увійти або зареєструватися' })).toBeVisible();
  expect(loginResponse?.headers()['x-content-type-options']).toBe('nosniff');
  expect(loginResponse?.headers()['x-frame-options']).toBe('SAMEORIGIN');

  await page.goto('/register', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login$/);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login\?next=%2F$/);

  const privacyResponse = await page.goto('/privacy-policy', { waitUntil: 'domcontentloaded' });
  expect(privacyResponse?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Політика');

  // Three segments cannot be mistaken for the top-level `[projectId]` route,
  // so this verifies the routing-level hard 404 rather than an authenticated
  // project lookup.
  const missingResponse = await page.goto('/route/does/not/exist', { waitUntil: 'domcontentloaded' });
  expect(missingResponse?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Сторінку не знайдено' })).toBeVisible();
  await expectHealthyPage(page, errors, [/server responded with a status of 404/]);
});

test('the public entry flow fits a phone viewport without horizontal overflow', async ({ page }) => {
  const errors = await preparePage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Увійти або зареєструватися' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectHealthyPage(page, errors);
});

test('help, releases and legal pages are public, searchable and mobile-safe', async ({ page }) => {
  const errors = await preparePage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const routes = [
    ['/help', 'Відповіді про реальну роботу сервісу'],
    ['/help/kanban-and-bulk-actions', 'Як змінити багато завдань одразу'],
    ['/news', 'Новини продукту'],
    ['/terms', 'Умови користування QuickTeam'],
    ['/privacy', 'Політика конфіденційності QuickTeam'],
    ['/offer', 'Публічна оферта QuickTeam'],
  ];

  for (const [route, heading] of routes) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), route).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(heading);
    await expect(page.getByRole('link', { name: 'QuickTeam — головна' })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${route} horizontal overflow`).toBeLessThanOrEqual(0);
  }

  await page.goto('/terms', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByText('Набуває чинності')).toHaveCount(0);
  await expect(page.getByText('Постачальник сервісу')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Назад' })).toHaveCount(0);

  const expectedMatches = searchHelpArticles(HELP_QUERY);
  expect(
    expectedMatches.length,
    `"${HELP_QUERY}" must still name exactly one article — pick another query`,
  ).toBe(1);

  await page.goto('/help', { waitUntil: 'domcontentloaded' });
  // The first server frame is readable before hydration. Retry the gesture
  // until the client handler is attached instead of sleeping for an arbitrary
  // machine-dependent delay. Clear first so every retry emits a fresh input
  // event even if an earlier attempt changed only the pre-hydration DOM value.
  await expect(async () => {
    const search = page.getByRole('textbox', { name: 'Пошук у довідці' });
    await search.fill('');
    await search.fill(HELP_QUERY);
    await expect(page.getByText(`Знайдено матеріалів: ${expectedMatches.length}`)).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.getByRole('link', { name: expectedMatches[0].title })).toBeVisible();

  await page.goto('/help/kanban-and-bulk-actions', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /Робота із задачами/ }).click();
  await expect(page).toHaveURL(/\/help\?category=work$/);
  await expect(page.getByRole('button', { name: 'Робота із задачами' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/privacy-policy', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/privacy$/);
  await expectHealthyPage(page, errors);
});

test('bulk toolbar remains usable at phone width and opens its confirm flow', async ({ page }) => {
  const errors = await preparePage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ui-kit', { waitUntil: 'domcontentloaded' });
  await openSection(page, 'task-elements', { via: 'select' });

  // The catalogue now shows the toolbar twice — idle, and mid-operation with
  // every control disabled. This flow is about the idle one.
  const toolbar = page.getByRole('toolbar', { name: 'Дії з вибраними завданнями: 4' });
  await expect(toolbar).toBeVisible();
  expect(await toolbar.evaluate(element => element.scrollWidth >= element.clientWidth)).toBe(true);
  // On a phone the less-frequent actions are intentionally reachable by
  // horizontal scrolling. Exercise that path instead of force-clicking a
  // clipped, off-screen coordinate in the catalogue preview.
  await toolbar.scrollIntoViewIfNeeded();
  await toolbar.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const moreActions = toolbar.getByRole('button', { name: 'Інші масові дії' });
  await expect(moreActions).toBeInViewport();
  await moreActions.click();
  const deadlineAction = page.getByRole('menuitem', { name: 'Встановити дедлайн' });
  await expect(deadlineAction).toBeVisible();
  await deadlineAction.click();
  await expect(page.getByRole('dialog', { name: /Дедлайн для 4 завдань/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expectHealthyPage(page, errors);
});

test('a custom sheet traps focus, closes on Escape and restores its opener', async ({ page }) => {
  const errors = await preparePage(page);
  await page.goto('/ui-kit', { waitUntil: 'domcontentloaded' });
  await openSection(page, 'buttons');

  const opener = page.locator('button[title^="Button:"]').first();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: /Де використовується/ });
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden');

  const controls = dialog.locator('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
  const first = controls.first();
  const last = controls.last();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  await expectHealthyPage(page, errors);
});
