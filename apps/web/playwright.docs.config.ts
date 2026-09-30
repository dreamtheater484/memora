import { defineConfig, devices } from '@playwright/test';

/*
 * The documentation's screenshots (docs/images), taken from a real Memora filled with the demo
 * dataset. Not a test suite: `node scripts/demo/screenshots.mjs` runs it.
 */
export default defineConfig({
  testDir: 'docs-screenshots',
  outputDir: 'test-results/docs',
  reporter: 'line',
  timeout: 90_000,
  workers: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.MEMORA_DOCS_URL,
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  },
});
