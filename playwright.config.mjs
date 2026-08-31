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
      // How different two pixels must be before they count as different at
      // all, and the default made this suite blind to the thing its own
      // workflow comment promises to catch.
      //
      // `threshold` is a YIQ distance normalised against 35215. A 1px `line`
      // border (#e9e9e9) appearing on a white card moves a pixel by dY=22,
      // which is 0.5053·22² / 35215 ≈ 0.007 — far under the default 0.2. So
      // every one of those pixels reads as unchanged, `maxDiffPixelRatio`
      // never gets a number to weigh, and the comparison reports a perfect
      // match. Found on 2026-09-01: `KpiCard` gained a visible border, the
      // live page renders 5473 pixels of it, and `progress.png` came back from
      // `--update-snapshots` byte-identical.
      //
      // 0.05 still ignores genuine rasterisation jitter, which moves a pixel
      // by a hair rather than by a whole shade, and the ratio above is left
      // where it was — it is the noise budget, and it was never the problem.
      threshold: 0.05,
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
