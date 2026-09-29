import { defineConfig, devices } from '@playwright/test';

/*
 * Visual snapshots and accessibility checks for the component gallery and the
 * app shell (decision D22), behaviour tests, and the resilience suite (§13.1).
 * Screenshots depend on fonts and rendering, so the committed baselines come
 * from the pinned Playwright image: run `pnpm test:visual` (Docker) locally,
 * and CI uses the same image.
 */
const port = 4173;

export default defineConfig({
  testDir: 'e2e',
  // One folder per spec, no platform suffix: baselines always come from the image.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 },
  },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    // Our CSS shortens every animation and transition under reduced motion.
    reducedMotion: 'reduce',
    // Dates and times on screen look the same wherever the tests run.
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
    // The fake server answers from the page's routes, which a service worker would get
    // around. The offline test lets it in.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Not losing a keystroke (§13.1) and pasting screenshots (§9.5) are proven in every
    // engine; the rest runs in Chromium.
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testMatch: ['resilience.spec.ts', 'paste.spec.ts'],
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: ['resilience.spec.ts', 'paste.spec.ts'],
    },
  ],
  webServer: {
    // The gallery build contains both index.html and gallery.html.
    command: `vite build --mode gallery && vite preview --mode gallery --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/gallery.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
