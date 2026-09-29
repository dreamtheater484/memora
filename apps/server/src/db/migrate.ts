import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { backupDatabase } from './backup';
import type { SqliteDatabase } from './client';

/** Drizzle's bookkeeping table: one row per applied migration, keyed by the migration timestamp. */
const MIGRATIONS_TABLE = '__drizzle_migrations';

export class DatabaseTooNewError extends Error {
  override name = 'DatabaseTooNewError';
}

export interface MigrationOptions {
  db: SqliteDatabase;
  migrationsDir: string;
  backupDir: string;
  appVersion: string;
}

export interface MigrationResult {
  applied: number;
  backupFile?: string;
}

function lastAppliedMigration(db: SqliteDatabase): number | null {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE);
  if (!table) return null;
  const row = db.prepare(`SELECT MAX(created_at) AS last FROM "${MIGRATIONS_TABLE}"`).get() as {
    last: number | null;
  };
  return row.last === null ? null : Number(row.last);
}

function hasAnyTables(db: SqliteDatabase): boolean {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get() as {
    n: number;
  };
  return row.n > 0;
}

/**
 * Brings the database schema up to date.
 *
 * - Refuses to touch a database created by a newer Memora version (downgrade protection).
 * - Takes a backup before applying migrations to an existing database.
 */
export async function runMigrations(options: MigrationOptions): Promise<MigrationResult> {
  const { db, migrationsDir, backupDir, appVersion } = options;
  const migrations = readMigrationFiles({ migrationsFolder: migrationsDir });
  const latestKnown = migrations.reduce((max, m) => Math.max(max, m.folderMillis), 0);
  const lastApplied = lastAppliedMigration(db);

  if (lastApplied !== null && lastApplied > latestKnown) {
    throw new DatabaseTooNewError(
      `This database was last used by a newer version of Memora than ${appVersion}. ` +
        'Upgrade Memora (or restore a backup made with this version); the database was not changed.',
    );
  }

  const pending = migrations.filter((m) => lastApplied === null || m.folderMillis > lastApplied);
  if (pending.length === 0) return { applied: 0 };

  const backupFile = hasAnyTables(db)
    ? await backupDatabase(db, backupDir, `pre-migration-v${appVersion}`)
    : undefined;

  migrate(drizzle(db), { migrationsFolder: migrationsDir, migrationsTable: MIGRATIONS_TABLE });
  return backupFile ? { applied: pending.length, backupFile } : { applied: pending.length };
}
