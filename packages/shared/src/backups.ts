/*
 * Backups (§9.14): one consistent file per backup (SQLite's online backup), optionally
 * encrypted (AES-256-GCM with a key from scrypt, `.enc`), kept in the backup folder with a
 * retention of daily, weekly and monthly ones. Administrators list, make, download and restore
 * them; restoring backs up first and restarts Memora.
 */

export const BACKUP_KINDS = ['scheduled', 'manual', 'pre-migration', 'pre-restore'] as const;
export type BackupKind = (typeof BACKUP_KINDS)[number];

export interface BackupInfo {
  /** The file name, which is also its id in the API. */
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: number;
  encrypted: boolean;
}

export interface BackupStatus {
  backups: BackupInfo[];
  /** The schedule (cron syntax), or null when scheduled backups are off. */
  schedule: string | null;
  nextRunAt: number | null;
  /** The last scheduled or manual backup since Memora started. */
  last: { at: number; ok: boolean; error?: string } | null;
  /** Whether new backups are encrypted (a password file is set). */
  encrypting: boolean;
  /** How many daily, weekly and monthly backups are kept. */
  keep: { daily: number; weekly: number; monthly: number };
}

/** `POST /admin/backups/:name/restore` answers this, and Memora restarts right after. */
export interface RestoreStarted {
  restarting: true;
  /** The backup of the current state taken first. */
  safetyBackup: string;
}

/** Backup file names: `memora-<kind>-<time>.db`, with `.enc` when encrypted. */
export const BACKUP_NAME =
  /^memora-(scheduled|manual|pre-migration|pre-restore)(-v[\w.+-]+?)?-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.db(\.enc)?$/;
