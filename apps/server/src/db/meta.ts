import { uuidv7 } from '@memora/shared';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
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

/**
 * The id of the data as it is now, made on first use. Restoring a backup gives the data a new
 * one, so browsers know to drop what they kept of the data before (§9.14).
 */
export function dataIdOf(db: SqliteDatabase): string {
  const orm = drizzle(db);
  orm.insert(appMeta).values({ key: 'data_id', value: uuidv7() }).onConflictDoNothing().run();
  const row = orm.select().from(appMeta).where(eq(appMeta.key, 'data_id')).get();
  if (!row) throw new Error('app_meta.data_id is missing after initialisation');
  return row.value;
}

/** Gives a database file (a backup about to be restored) a new data id. */
export function renewDataId(file: string): string {
  const id = uuidv7();
  const db = new Database(file, { fileMustExist: true });
  try {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('data_id', ?)").run(id);
  } finally {
    db.close();
  }
  return id;
}
