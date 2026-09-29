import { createHash } from 'node:crypto';
import type { AssetMeta } from '@memora/shared';
import { and, eq } from 'drizzle-orm';
import type { SqliteDatabase } from '../db/client';
import { assetBlobs, assets, type AssetRow } from '../db/schema';
import { ApiError, notFound } from '../errors';
import type { Orm } from '../repo';
import { storedType } from './image';

/*
 * Images and attachments (§7.3, §9.5), owner-scoped like the notes: another user's asset id
 * is simply not found. Uploading the same id again with the same bytes is a no-op, so a
 * browser that lost the answer can simply send it again.
 */

export interface StoredAsset {
  meta: AssetMeta;
  sha256: string;
  data: Buffer;
}

const toMeta = (row: AssetRow): AssetMeta => ({
  id: row.id,
  mime: row.mime,
  size: row.size,
  width: row.width,
  height: row.height,
  name: row.originalName,
  createdAt: row.createdAt,
});

export class AssetsService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly orm: Orm,
    private readonly now: () => number,
  ) {}

  /** Stores a file under the id the browser chose; `created` is false for a repeat. */
  put(
    owner: string,
    id: string,
    input: { name: string; claimedType: string | undefined; data: Buffer },
  ): { meta: AssetMeta; created: boolean } {
    const sha256 = createHash('sha256').update(input.data).digest('hex');
    return this.db.transaction(() => {
      const existing = this.orm.select().from(assets).where(eq(assets.id, id)).get();
      if (existing) {
        if (existing.ownerId === owner && existing.sha256 === sha256) {
          return { meta: toMeta(existing), created: false };
        }
        throw new ApiError(409, 'asset_exists', 'A different file already has this id.');
      }
      const type = storedType(input.data, input.claimedType);
      this.orm
        .insert(assetBlobs)
        .values({ ownerId: owner, sha256, data: input.data })
        .onConflictDoNothing()
        .run();
      const row = this.orm
        .insert(assets)
        .values({
          id,
          ownerId: owner,
          sha256,
          mime: type.mime,
          size: input.data.length,
          width: type.width,
          height: type.height,
          originalName: input.name,
          createdAt: this.now(),
        })
        .returning()
        .get();
      return { meta: toMeta(row), created: true };
    })();
  }

  get(owner: string, id: string): StoredAsset {
    const row = this.orm
      .select({ asset: assets, data: assetBlobs.data })
      .from(assets)
      .innerJoin(
        assetBlobs,
        and(eq(assetBlobs.ownerId, assets.ownerId), eq(assetBlobs.sha256, assets.sha256)),
      )
      .where(and(eq(assets.id, id), eq(assets.ownerId, owner)))
      .get();
    if (!row) throw notFound('File not found.');
    return { meta: toMeta(row.asset), sha256: row.asset.sha256, data: row.data };
  }
}
