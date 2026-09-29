import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

/** Opens (or creates) the SQLite database with Memora's durability settings. */
export function openDatabase(file: string): SqliteDatabase {
  const db = new Database(file);
  // WAL: readers never block the writer.
  db.pragma('journal_mode = WAL');
  // FULL: a save the server has confirmed survives a power cut. Clients drop their local copy
  // only after that confirmation, so this is what makes "never lose a keystroke" hold end to end.
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // The page cache stays at SQLite's small default (about 2 MB) to keep RAM use low on the NAS.
  return db;
}
