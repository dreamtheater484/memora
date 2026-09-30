import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests of the packaged desktop app (test/), on the system they run on: CI runs
 * them on Windows, macOS and Ubuntu against the app it has just built.
 */
export default defineConfig({
  testDir: 'test',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { trace: 'retain-on-failure' },
});
