import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SqliteDatabase } from './client';

/**
 * Writes a consistent single-file copy of the live database using SQLite's online backup API.
 * Safe while the app is running, unlike copying memora.db (plus its -wal file) by hand.
 */
export async function backupDatabase(
  db: SqliteDatabase,
  backupDir: string,
  label: string,
): Promise<string> {
  await mkdir(backupDir, { recursive: true });
  // No colons in file names, so backups can be copied to Windows and FAT/exFAT drives.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(backupDir, `memora-${label}-${stamp}.db`);
  await db.backup(file);
  return file;
}
