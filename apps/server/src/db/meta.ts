import { uuidv7 } from '@memora/shared';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { SqliteDatabase } from './client';
import { appMeta } from './schema';

/** Records the instance id and creating version on first start; returns the instance id. */
export function ensureInstanceMeta(db: SqliteDatabase, appVersion: string): string {
  const orm = drizzle(db);
  orm
    .insert(appMeta)
    .values([
      { key: 'instance_id', value: uuidv7() },
      { key: 'created_with_version', value: appVersion },
    ])
    .onConflictDoNothing()
    .run();
  const row = orm.select().from(appMeta).where(eq(appMeta.key, 'instance_id')).get();
  if (!row) throw new Error('app_meta.instance_id is missing after initialisation');
  return row.value;
}
