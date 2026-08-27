// playwright.config.mjs — screenshot diff for /ui-kit.
//
// The catalogue is the only page these tests touch, and it is served by
// `next dev` on purpose: src/proxy.js lets /ui-kit through without a session
// only while NODE_ENV === 'development'. A production build would redirect the
// run to /login, so there is nothing to gain from building first.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.UI_KIT_PORT || 3100);

export default defineConfig({
  testDir: './tests/visual',

  // Baselines are PNGs in the repository, one per section, named after the
  // section id — no platform suffix, because only one platform ever writes
  // them (see `ignoreSnapshots` below).
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',

  // Font rasterisation differs between Windows and the Linux runner, so a
  // local run can never match a committed baseline. Locally the spec is a
  // smoke test: it drives every section and fails on a console error or a
  // broken render, but compares no pixels and — importantly — cannot write a
  // Windows baseline into the repository by accident.
  ignoreSnapshots: !process.env.CI,

  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list']],

  expect: {
    toHaveScreenshot: {
      // Antialiasing noise on text edges is a few dozen pixels; a moved
      // control is thousands. This threshold sits between the two.
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },

  use: {
    // `localhost`, not `127.0.0.1`: Next 16 treats them as different dev
    // origins and refuses to boot the client runtime on the second one. The
    // page still renders — server-side — so the failure looks like a page that
    // simply ignores every click, with an empty console and no failed request.
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'uk-UA',
    timezoneId: 'UTC',
    trace: process.env.CI ? 'on-first-retry' : 'off',
  },

  projects: [{ name: 'chromium' }],

  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/ui-kit`,
    reuseExistingServer: !process.env.CI,
    // The first dev compile of a 3000-line client page is slow on a cold
    // runner cache.
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
