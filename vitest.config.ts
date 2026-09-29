import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/server/src/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
          environment: 'node',
        },
      },
      // The web app runs its tests in jsdom (apps/web/vitest.config.ts).
      'apps/web',
    ],
  },
});
