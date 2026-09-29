import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsDir } from '../paths';
import { openDatabase, type SqliteDatabase } from './client';
import { ensureInstanceMeta } from './meta';
import { DatabaseTooNewError, runMigrations } from './migrate';

let tempDir: string;
let backupDir: string;
let db: SqliteDatabase;

/** Writes a Drizzle-style migrations folder containing the given migrations. */
function writeMigrations(name: string, migrations: { tag: string; when: number; sql: string }[]) {
  const dir = join(tempDir, name);
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const entries = migrations.map((m, idx) => ({
    idx,
    version: '6',
    when: m.when,
    tag: m.tag,
    breakpoints: true,
  }));
  writeFileSync(
    join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'sqlite', entries }),
  );
  for (const m of migrations) writeFileSync(join(dir, `${m.tag}.sql`), m.sql);
  return dir;
}

const first = { tag: '0000_first', when: 1_000, sql: 'CREATE TABLE a (id integer PRIMARY KEY);' };
const second = { tag: '0001_second', when: 2_000, sql: 'CREATE TABLE b (id integer PRIMARY KEY);' };

const tables = () =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
    .map((row) => row.name)
    .filter((name) => !name.startsWith('__') && !name.startsWith('sqlite_'))
    .sort();

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'memora-migrate-'));
  backupDir = join(tempDir, 'backups');
  db = openDatabase(join(tempDir, 'memora.db'));
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('runMigrations', () => {
  it('applies the real migrations to a fresh database without taking a backup', async () => {
    const result = await runMigrations({ db, migrationsDir, backupDir, appVersion: '0.1.0' });
    expect(result.applied).toBeGreaterThan(0);
    expect(result.backupFile).toBeUndefined();
    expect(tables()).toContain('app_meta');
  });

  it('does nothing when the schema is current', async () => {
    const dir = writeMigrations('v1', [first]);
    await runMigrations({ db, migrationsDir: dir, backupDir, appVersion: '1.0.0' });
    const again = await runMigrations({ db, migrationsDir: dir, backupDir, appVersion: '1.0.0' });
    expect(again).toEqual({ applied: 0 });
  });

  it('backs up an existing database before applying new migrations', async () => {
    await runMigrations({
      db,
      migrationsDir: writeMigrations('v1', [first]),
      backupDir,
      appVersion: '1.0.0',
    });
    const result = await runMigrations({
      db,
      migrationsDir: writeMigrations('v2', [first, second]),
      backupDir,
      appVersion: '2.0.0',
    });
    expect(result.applied).toBe(1);
    expect(result.backupFile).toMatch(/memora-pre-migration-v2\.0\.0-.*\.db$/);
    expect(readdirSync(backupDir)).toHaveLength(1);
    expect(tables()).toEqual(['a', 'b']);
  });

  it('refuses a database created by a newer version and leaves it untouched', async () => {
    await runMigrations({
      db,
      migrationsDir: writeMigrations('v2', [first, second]),
      backupDir,
      appVersion: '2.0.0',
    });
    await expect(
      runMigrations({
        db,
        migrationsDir: writeMigrations('v1', [first]),
        backupDir,
        appVersion: '1.0.0',
      }),
    ).rejects.toBeInstanceOf(DatabaseTooNewError);
    expect(tables()).toEqual(['a', 'b']);
  });
});

describe('ensureInstanceMeta', () => {
  it('creates a stable instance id', async () => {
    await runMigrations({ db, migrationsDir, backupDir, appVersion: '0.1.0' });
    const id = ensureInstanceMeta(db, '0.1.0');
    expect(ensureInstanceMeta(db, '0.2.0')).toBe(id);
    const created = db
      .prepare("SELECT value FROM app_meta WHERE key = 'created_with_version'")
      .get();
    expect(created).toEqual({ value: '0.1.0' });
  });
});
