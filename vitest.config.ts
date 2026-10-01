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
          // Most server tests start a whole app (database, migrations, password hashing),
          // which can take more than the default 5 s on a busy Windows runner.
          testTimeout: 15_000,
        },
      },
      // The web app runs its tests in jsdom (apps/web/vitest.config.ts).
      'apps/web',
    ],
  },
});
