import { uuidv7, type Tree } from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type Client, type TestApp } from '../test/harness';

/* Search with 10,000 pages, against its budget (§14). Runs on its own once the other tests are
   done (the perf project in vitest.config.ts). */

let t: TestApp;
let me: Client;
let inboxId: string;

beforeEach(async () => {
  t = await createTestApp();
  me = await t.setupAdmin('alex');
  inboxId = ((await me.get('/api/v1/tree')).json() as Tree).inboxId;
});
afterEach(async () => {
  await t.close();
});

describe('search', () => {
  it('stays within budget with 10,000 pages', async () => {
    const words = ['plan', 'garden', 'budget', 'meeting', 'travel', 'recipe', 'idea', 'review'];
    const insert = t.db.prepare(
      `INSERT INTO pages (id, owner_id, section_id, title, type, content, content_text, sort_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'markdown', ?, ?, ?, ?, ?)`,
    );
    const owner = (t.db.prepare('SELECT id FROM users').get() as { id: string }).id;
    t.db.transaction(() => {
      for (let i = 0; i < 10_000; i += 1) {
        const text = Array.from(
          { length: 60 },
          (_, j) => words[(i * 7 + j * 3) % words.length],
        ).join(' ');
        insert.run(
          uuidv7(),
          owner,
          inboxId,
          `Note ${i} ${words[i % words.length]}`,
          text,
          text,
          `a${i}`,
          i,
          i,
        );
      }
    })();
    const times: number[] = [];
    const queries = ['garden', 'plan bud', '"travel recipe"', 'idea -review', 'note 99', 'meet'];
    // Warmed up first, and enough samples that one pause of a shared CI machine doesn't decide
    // the 95th percentile.
    for (const q of queries) await me.get(`/api/v1/search?q=${encodeURIComponent(q)}`);
    for (const q of queries) {
      for (let i = 0; i < 10; i += 1) {
        const started = performance.now();
        const res = await me.get(`/api/v1/search?q=${encodeURIComponent(q)}`);
        times.push(performance.now() - started);
        expect(res.statusCode).toBe(200);
      }
    }
    times.sort((x, y) => x - y);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    // The budget (§14) is for the Linux image. Shared Windows CI machines run the same code at
    // about the budget itself, so there the test only catches gross slowdowns.
    const budget = process.platform === 'win32' ? 200 : 100;
    expect(p95, `95th percentile ${p95.toFixed(1)} ms`).toBeLessThan(budget);
  });
});
