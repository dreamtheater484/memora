import type { SqliteDatabase } from '../db/client';
import type { Table } from './tables';

/*
 * Capturing changes (ADR 0006): while sync is on, a trigger on each synced table notes every
 * changed row in `sync_dirty`, with the row as it was before its first change since the last
 * run (its base, for merging). The triggers are made from the schema as it is at each start,
 * so a column added by an update is captured too. Changes sync applies itself are not
 * captured: it sets `mute` in `sync_state` while it applies them, in the same transaction.
 */

const PREFIX = 'memora_sync_';

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

function triggerSql(table: Table): string[] {
  const t = quote(table.name);
  const key = (row: 'NEW' | 'OLD') =>
    `json_array(${table.key.map((c) => `${row}.${quote(c)}`).join(', ')})`;
  const base = `json_object(${table.columns
    .filter((c) => c.name !== table.blob)
    .map((c) => `${literal(c.name)}, OLD.${quote(c.name)}`)
    .join(', ')})`;
  const when = `WHEN NOT EXISTS (SELECT 1 FROM sync_state WHERE key = 'mute')`;
  const note = (row: 'NEW' | 'OLD', baseValue: string) =>
    `INSERT INTO sync_dirty (tbl, key, base, ver) VALUES (${literal(table.name)}, ${key(row)}, ${baseValue}, 1) ON CONFLICT (tbl, key) DO UPDATE SET ver = ver + 1;`;
  const name = (what: string) => quote(`${PREFIX}${table.name}_${what}`);
  return [
    `CREATE TRIGGER ${name('insert')} AFTER INSERT ON ${t} ${when} BEGIN ${note('NEW', 'NULL')} END`,
    `CREATE TRIGGER ${name('update')} AFTER UPDATE ON ${t} ${when} BEGIN ${note('NEW', base)} END`,
    `CREATE TRIGGER ${name('delete')} AFTER DELETE ON ${t} ${when} BEGIN ${note('OLD', base)} END`,
  ];
}

/** Sync's triggers in the database now. */
function installed(db: SqliteDatabase): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE ?")
      .all(`${PREFIX}%`) as { name: string }[]
  ).map((row) => row.name);
}

/** Removes sync's triggers: before migrations, and when sync is turned off. */
export function removeCapture(db: SqliteDatabase): void {
  db.transaction(() => {
    for (const name of installed(db)) db.exec(`DROP TRIGGER IF EXISTS ${quote(name)}`);
  })();
}

/** (Re)makes sync's triggers for the schema as it is now. */
export function installCapture(db: SqliteDatabase, tables: Iterable<Table>): void {
  db.transaction(() => {
    for (const name of installed(db)) db.exec(`DROP TRIGGER IF EXISTS ${quote(name)}`);
    for (const table of tables) for (const sql of triggerSql(table)) db.exec(sql);
  })();
}

export const isCapturing = (db: SqliteDatabase): boolean => installed(db).length > 0;
