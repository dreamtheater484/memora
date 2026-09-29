import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  BACKUP_NAME,
  type BackupInfo,
  type BackupKind,
  type BackupStatus,
  type RestoreStarted,
} from '@memora/shared';
import Database from 'better-sqlite3';
import type { Config } from '../config';
import type { SqliteDatabase } from '../db/client';
import { ApiError, notFound } from '../errors';
import { nextRun } from './cron';
import { EnvelopeError, decryptFile, encryptFile, isEncrypted } from './envelope';

/*
 * Backups (§9.14). Each is one consistent file made with SQLite's online backup while Memora
 * runs, encrypted when a password file is set, and kept by a retention of daily, weekly and
 * monthly backups (plus everything from the last day). Restoring checks the backup, backs up
 * the current state, leaves the backup ready in `restore/`, and restarts Memora, which puts it
 * in place before it opens the database (applyPendingRestore). The running database is never
 * overwritten under the server's feet.
 */

export interface BackupLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Longest a timer may wait (Node's limit); later runs are rescheduled from there. */
const MAX_TIMER_MS = 2 ** 31 - 1;
const DAY = 24 * 3_600_000;

const RESTORE_DIR = 'restore';
const PENDING_FILE = 'pending.db';
const MARKER = 'pending.json';

/** The time in a backup's name: `2026-09-30T03-00-00-000Z`. */
function createdAtOf(stamp: string): number {
  const iso = stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  return Date.parse(iso);
}

/**
 * Which backups a retention keeps: everything from the last day, and the newest of each of
 * the last `daily` days, `weekly` weeks and `monthly` months that have a backup (UTC).
 */
export function backupsToKeep(
  backups: readonly BackupInfo[],
  now: number,
  keep: { daily: number; weekly: number; monthly: number },
): Set<string> {
  const kept = new Set<string>();
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  for (const b of sorted) if (now - b.createdAt < DAY) kept.add(b.name);
  const pick = (count: number, bucket: (t: number) => string) => {
    const seen = new Set<string>();
    for (const b of sorted) {
      if (seen.size >= count) break;
      const key = bucket(b.createdAt);
      if (seen.has(key)) continue;
      seen.add(key);
      kept.add(b.name);
    }
  };
  pick(keep.daily, (t) => new Date(t).toISOString().slice(0, 10));
  // Weeks from Monday (1970-01-01 was a Thursday).
  pick(keep.weekly, (t) => String(Math.floor((t + 3 * DAY) / (7 * DAY))));
  pick(keep.monthly, (t) => new Date(t).toISOString().slice(0, 7));
  return kept;
}

/** Checks that a file is a Memora database that SQLite finds sound. */
function checkDatabase(file: string): void {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const result = db.pragma('integrity_check', { simple: true });
    if (result !== 'ok') throw new Error(String(result));
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((t) => t.name),
    );
    if (!tables.has('users') || !tables.has('pages')) throw new Error('not a Memora database');
  } catch (error) {
    throw new ApiError(
      422,
      'invalid_request',
      `This backup can’t be restored: ${error instanceof Error ? error.message : 'it is damaged'}.`,
    );
  } finally {
    db?.close();
  }
}

export class BackupService {
  private last: BackupStatus['last'] = null;
  private timer: NodeJS.Timeout | undefined;
  private nextAt: number | null = null;
  private running: Promise<BackupInfo> | null = null;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly config: Pick<
      Config,
      'backupDir' | 'dataDir' | 'backupSchedule' | 'backupKeep' | 'backupPasswordFile'
    >,
    private readonly log: BackupLogger,
    private readonly now: () => number = Date.now,
  ) {}

  // Listing

  async list(): Promise<BackupInfo[]> {
    let names: string[];
    try {
      names = await readdir(this.config.backupDir);
    } catch {
      return [];
    }
    const backups: BackupInfo[] = [];
    for (const name of names) {
      const match = BACKUP_NAME.exec(name);
      if (!match) continue;
      const info = await stat(join(this.config.backupDir, name)).catch(() => null);
      if (!info?.isFile()) continue;
      backups.push({
        name,
        kind: match[1] as BackupKind,
        size: info.size,
        createdAt: createdAtOf(match[3]!) || info.mtimeMs,
        encrypted: name.endsWith('.enc'),
      });
    }
    return backups.sort((a, b) => b.createdAt - a.createdAt);
  }

  async status(): Promise<BackupStatus> {
    return {
      backups: await this.list(),
      schedule: this.config.backupSchedule?.source ?? null,
      nextRunAt: this.nextAt,
      last: this.last,
      encrypting: !!this.config.backupPasswordFile,
      keep: this.config.backupKeep,
    };
  }

  /** The path of a backup by its name; only names the list would show. */
  pathOf(name: string): string {
    if (!BACKUP_NAME.test(name)) throw notFound('Backup not found.');
    const file = join(this.config.backupDir, name);
    if (!existsSync(file)) throw notFound('Backup not found.');
    return file;
  }

  async remove(name: string): Promise<void> {
    await rm(this.pathOf(name));
  }

  // Making

  /** Makes a backup now; one at a time (a second request waits for the running one). */
  create(kind: BackupKind): Promise<BackupInfo> {
    if (this.running) return this.running;
    this.running = this.write(kind)
      .then(
        (info) => {
          this.last = { at: this.now(), ok: true };
          this.log.info({ backup: info.name, size: info.size }, 'backup written');
          return info;
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.last = { at: this.now(), ok: false, error: message };
          this.log.error({ err: error }, 'backup failed');
          throw error;
        },
      )
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async password(): Promise<string | null> {
    const file = this.config.backupPasswordFile;
    if (!file) return null;
    let password: string;
    try {
      password = (await readFile(file, 'utf8')).trim();
    } catch {
      throw new Error(`The backup password file (${file}) can’t be read.`);
    }
    if (password.length < 8) throw new Error('The backup password must be at least 8 characters.');
    return password;
  }

  private async write(kind: BackupKind): Promise<BackupInfo> {
    const dir = this.config.backupDir;
    await mkdir(dir, { recursive: true });
    const createdAt = this.now();
    // No colons, so backups copy to Windows and FAT/exFAT drives.
    const stamp = new Date(createdAt).toISOString().replace(/[:.]/g, '-');
    const plainName = `memora-${kind}-${stamp}.db`;
    const partial = join(dir, `.${plainName}.partial`);
    const password = await this.password();
    const name = password ? `${plainName}.enc` : plainName;
    try {
      await this.db.backup(partial);
      if (password) await encryptFile(partial, join(dir, name), password);
      else await rename(partial, join(dir, name));
    } finally {
      await rm(partial, { force: true });
    }
    const { size } = await stat(join(dir, name));
    await this.prune().catch((error: unknown) =>
      this.log.error({ err: error }, 'removing old backups failed'),
    );
    return { name, kind, size, createdAt, encrypted: !!password };
  }

  /** Removes backups the retention no longer keeps; answers their names. */
  async prune(): Promise<string[]> {
    const backups = await this.list();
    const keep = backupsToKeep(backups, this.now(), this.config.backupKeep);
    const drop = backups.filter((b) => !keep.has(b.name)).map((b) => b.name);
    for (const name of drop) await rm(join(this.config.backupDir, name), { force: true });
    return drop;
  }

  // Scheduling

  start(): void {
    this.stop();
    const schedule = this.config.backupSchedule;
    if (!schedule) return;
    const next = nextRun(schedule, new Date(this.now()));
    this.nextAt = next?.getTime() ?? null;
    if (!next) return;
    const wait = next.getTime() - this.now();
    this.timer = setTimeout(
      () => {
        if (this.now() + 1000 < next.getTime()) return this.start();
        void this.create('scheduled')
          .catch(() => undefined)
          .finally(() => this.start());
      },
      Math.min(Math.max(wait, 0), MAX_TIMER_MS),
    );
    this.timer.unref();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.nextAt = null;
  }

  // Restoring

  /**
   * Gets a backup ready to be restored: decrypted (if it is), checked, and in `restore/`, with
   * a backup of the current state taken first. Memora must then restart to put it in place.
   */
  async prepareRestore(name: string): Promise<RestoreStarted> {
    const source = this.pathOf(name);
    const dir = join(this.config.dataDir, RESTORE_DIR);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const pending = join(dir, PENDING_FILE);
    try {
      if (await isEncrypted(source)) {
        const password = await this.password().catch(() => null);
        if (!password) {
          throw new ApiError(
            422,
            'invalid_request',
            'This backup is encrypted: set MEMORA_BACKUP_PASSWORD_FILE to its password first.',
          );
        }
        await decryptFile(source, pending, password).catch((error: unknown) => {
          throw error instanceof EnvelopeError
            ? new ApiError(422, 'invalid_request', error.message)
            : error;
        });
      } else await copyFile(source, pending);
      checkDatabase(pending);
      const safety = await this.create('pre-restore');
      await writeFile(
        join(dir, MARKER),
        JSON.stringify({ from: name, at: this.now(), safetyBackup: safety.name }),
      );
      return { restarting: true, safetyBackup: safety.name };
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }
}

/**
 * At startup, before the database is opened: puts a backup that is ready to be restored in
 * place. Answers the backup's name, or null when there was none.
 */
export function applyPendingRestore(dataDir: string, databaseFile: string): string | null {
  const dir = join(dataDir, RESTORE_DIR);
  const marker = join(dir, MARKER);
  if (!existsSync(marker)) return null;
  const pending = join(dir, PENDING_FILE);
  let from = 'a backup';
  try {
    from = (JSON.parse(readFileSync(marker, 'utf8')) as { from?: string }).from ?? from;
  } catch {
    // The name is only for the log.
  }
  if (!existsSync(pending)) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  // The server closed its database before restarting, so the write-ahead log is empty; the
  // current state is in the pre-restore backup either way.
  for (const suffix of ['-wal', '-shm']) rmSync(databaseFile + suffix, { force: true });
  renameSync(pending, databaseFile);
  rmSync(dir, { recursive: true, force: true });
  return from;
}
