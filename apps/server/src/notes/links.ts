import { linkedTitles, titleKey, type PageType } from '@memora/shared';
import type { SqliteDatabase } from '../db/client';

/*
 * The links between pages (§9.9) are indexed as pages are saved. Pages from before links were
 * indexed (Phase 8) are indexed once, at the first start after the update.
 */

const FLAG = 'links_indexed';
const BATCH = 200;

/** Indexes every page's links unless that was done; answers how many pages were read. */
export function indexAllLinksOnce(db: SqliteDatabase): number {
  const done = db.prepare('SELECT 1 FROM app_meta WHERE key = ?').get(FLAG);
  if (done) return 0;
  const read = db.prepare('SELECT id, type, content FROM pages WHERE id > ? ORDER BY id LIMIT ?');
  const clear = db.prepare('DELETE FROM page_links WHERE source_page_id = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO page_links (source_page_id, target_title, target_key) VALUES (?, ?, ?)',
  );
  let last = '';
  let total = 0;
  for (;;) {
    const rows = read.all(last, BATCH) as { id: string; type: PageType; content: string }[];
    if (!rows.length) break;
    db.transaction(() => {
      for (const row of rows) {
        clear.run(row.id);
        for (const title of linkedTitles(row.type, row.content)) {
          insert.run(row.id, title, titleKey(title));
        }
      }
    })();
    total += rows.length;
    last = rows.at(-1)!.id;
  }
  db.prepare('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)').run(FLAG, '1');
  return total;
}
