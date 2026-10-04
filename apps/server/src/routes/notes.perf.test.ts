import { uuidv7, type Tree, type TreeChanges } from '@memora/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type Client, type TestApp } from '../test/harness';

/* The tree with 1,000 pages, against its time limit. Runs on its own once the other tests are
   done (the perf project in vitest.config.ts). */

let t: TestApp;
let me: Client;

beforeEach(async () => {
  t = await createTestApp();
  me = await t.setupAdmin('alex');
});
afterEach(async () => {
  await t.close();
});

const tree = async (): Promise<Tree> => (await me.get('/api/v1/tree')).json();

describe('tree', () => {
  it('answers quickly with 1,000 pages', async () => {
    const section = (
      (await me.post('/api/v1/notebooks', { name: 'Work', color: 'blue' })).json() as TreeChanges
    ).sections![0]!;
    const insert = t.db.prepare(
      `INSERT INTO pages (id, owner_id, section_id, title, type, content, content_text, sort_key, created_at, updated_at)
       VALUES (?, (SELECT owner_id FROM sections WHERE id = ?), ?, ?, 'markdown', ?, ?, ?, 0, 0)`,
    );
    const text = 'Lorem ipsum dolor sit amet. '.repeat(200);
    t.db.transaction(() => {
      for (let i = 0; i < 1000; i += 1) {
        insert.run(
          uuidv7(),
          section.id,
          section.id,
          `Page ${i}`,
          text,
          text,
          `a${String(i).padStart(4, '0')}`,
        );
      }
    })();
    await tree(); // warm up
    const started = performance.now();
    const result = await tree();
    const elapsed = performance.now() - started;
    expect(result.pages).toHaveLength(1000);
    expect(result.pages[0]!.snippet).toHaveLength(140);
    expect(elapsed).toBeLessThan(150);
  });
});
