import { defaultExclude, defineConfig } from 'vitest/config';

// Tests that time the server against a budget (*.perf.test.ts, see §14). Next to other test files
// they would time how busy the machine is, so they run on their own, one file at a time, once all
// the other tests are done. The pre-push hook also waits for the type check (lefthook.yml).
const timed = ['apps/server/src/**/*.perf.test.ts'];

const node = {
  environment: 'node',
  // Most server tests start a whole app (database, migrations, password hashing),
  // which can take more than the default 5 s on a busy Windows runner.
  testTimeout: 15_000,
} as const;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...node,
          name: 'node',
          include: [
            'packages/*/src/**/*.test.ts',
            'apps/server/src/**/*.test.ts',
            'scripts/**/*.test.mjs',
          ],
          exclude: [...defaultExclude, ...timed],
        },
      },
      // The web app runs its tests in jsdom (apps/web/vitest.config.ts).
      'apps/web',
      {
        test: {
          ...node,
          name: 'perf',
          include: timed,
          sequence: { groupOrder: 1 },
          maxWorkers: 1,
        },
      },
    ],
  },
});
