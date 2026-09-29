import { assetIdsIn } from '@memora/shared';
import type { SqliteDatabase } from '../db/client';

/*
 * Removing files no page uses any more (§9.7): after the recycle bin is purged, and once a
 * day. A file is in use while any page (in the recycle bin too) or any kept version refers to
 * it as `asset:<id>`, in Markdown or in a rich page's document alike. New files are left
 * alone for a day: a page pasted into offline sends its files before its text.
 */

export const ASSET_GRACE_MS = 24 * 3_600_000;

/** Deletes unused files of the given users (all when none are given); answers how many. */
export function cleanUnusedAssets(
  db: SqliteDatabase,
  now: number,
  owners?: readonly string[],
): number {
  const users =
    owners ??
    (db.prepare('SELECT DISTINCT owner_id AS id FROM assets').all() as { id: string }[]).map(
      (r) => r.id,
    );
  let removed = 0;
  for (const owner of users) {
    const used = new Set<string>();
    // Streamed row by row: the whole library never sits in memory at once.
    for (const sql of [
      'SELECT content FROM pages WHERE owner_id = ?',
      'SELECT content FROM page_versions WHERE owner_id = ?',
    ]) {
      for (const row of db.prepare(sql).iterate(owner) as Iterable<{ content: string }>) {
        if (row.content.includes('asset:')) for (const id of assetIdsIn(row.content)) used.add(id);
      }
    }
    const candidates = (
      db
        .prepare('SELECT id FROM assets WHERE owner_id = ? AND created_at < ?')
        .all(owner, now - ASSET_GRACE_MS) as { id: string }[]
    )
      .map((r) => r.id)
      .filter((id) => !used.has(id.toLowerCase()));
    if (!candidates.length) continue;
    db.transaction(() => {
      const drop = db.prepare('DELETE FROM assets WHERE id = ? AND owner_id = ?');
      for (const id of candidates) removed += drop.run(id, owner).changes;
      // Bytes no remaining file points at.
      db.prepare(
        `DELETE FROM asset_blobs WHERE owner_id = ? AND NOT EXISTS (
           SELECT 1 FROM assets a WHERE a.owner_id = asset_blobs.owner_id AND a.sha256 = asset_blobs.sha256
         )`,
      ).run(owner);
    })();
  }
  return removed;
}
