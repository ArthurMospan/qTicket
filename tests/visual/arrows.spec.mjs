import { test, expect } from '@playwright/test';
import { openSection } from './hydration.mjs';

test('стрілки зʼявляються лише коли тулбар не вміщається, і прокручують його', async ({ page }) => {
  await page.goto('/ui-kit');
  await openSection(page, 'task-elements');

  const toolbar = page.locator('.hide-scrollbar.overflow-x-auto').first();
  await expect(toolbar).toBeVisible();

  const setWidth = width => toolbar.evaluate((node, value) => {
    const editor = node.closest('div[class*="rounded-"]');
    (editor?.parentElement || editor).style.width = value;
  }, width);

  // Широко: прокручувати нема чого, стрілок немає.
  await setWidth('1000px');
  await page.waitForTimeout(500);
  const wideRight = await page.getByRole('button', { name: 'Прокрутити праворуч' }).count();
  const wideLeft = await page.getByRole('button', { name: 'Прокрутити ліворуч' }).count();

  // Вузько: зʼявляється права стрілка, лівої ще немає.
  await setWidth('340px');
  await page.waitForTimeout(500);
  const right = page.getByRole('button', { name: 'Прокрутити праворуч' }).first();
  await expect(right).toBeVisible();
  const narrowLeft = await page.getByRole('button', { name: 'Прокрутити ліворуч' }).count();

  const before = await toolbar.evaluate(node => node.scrollLeft);
  await right.click();
  await page.waitForTimeout(900);
  const after = await toolbar.evaluate(node => node.scrollLeft);

  await expect(page.getByRole('button', { name: 'Прокрутити ліворуч' }).first()).toBeVisible();

  console.log(JSON.stringify({
    широко: { праворуч: wideRight, ліворуч: wideLeft },
    вузько: { ліворучДоКліку: narrowLeft },
    scrollLeft: { до: before, після: after },
  }));

  expect(wideRight).toBe(0);
  expect(wideLeft).toBe(0);
  expect(narrowLeft).toBe(0);
  expect(after).toBeGreaterThan(before);
});
