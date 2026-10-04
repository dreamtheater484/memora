import { join, resolve } from 'node:path';
import { DEFAULT_MAX_UPLOAD_MB, DEFAULT_TRASH_DAYS } from '@memora/shared';
import { z } from 'zod';
import { parseSchedule, type Schedule } from './backup/cron';
import { DEFAULT_RETENTION, parseRetention, type RetentionRules } from './notes/retention';
import { defaultWebDir } from './paths';

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MEMORA_DATA_DIR: z.string().optional(),
  MEMORA_BACKUP_DIR: z.string().optional(),
  MEMORA_WEB_DIR: z.string().optional(),
  MEMORA_BASE_URL: z.url({ protocol: /^https?$/ }).optional(),
  MEMORA_LOG_LEVEL: z.enum(logLevels).default('info'),
  MEMORA_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  MEMORA_SESSION_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(12),
  MEMORA_TRUST_PROXY: z.string().default('loopback,linklocal,uniquelocal'),
  MEMORA_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(1024).default(DEFAULT_MAX_UPLOAD_MB),
  MEMORA_TRASH_DAYS: z.coerce.number().int().min(1).max(3650).default(DEFAULT_TRASH_DAYS),
  MEMORA_HISTORY_RETENTION: z.string().default('48h,14d,90d'),
  MEMORA_BACKUP_SCHEDULE: z.string().default('0 3 * * *'),
  MEMORA_BACKUP_KEEP: z
    .string()
    .regex(
      /^\s*\d+\s*,\s*\d+\s*,\s*\d+\s*$/,
      'Three numbers: daily, weekly, monthly (like 7,4,12).',
    )
    .default('7,4,12'),
  MEMORA_BACKUP_PASSWORD_FILE: z.string().optional(),
  MEMORA_MAX_IMPORT_MB: z.coerce.number().int().min(1).max(16384).default(1024),
  MEMORA_GOTENBERG_URL: z.url({ protocol: /^https?$/ }).optional(),
  MEMORA_SECRET_KEY_FILE: z.string().min(1).optional(),
  /** Set by the desktop app (apps/desktop): the secret its window signs in with. */
  MEMORA_DESKTOP_TOKEN: z.string().min(32).optional(),
  MEMORA_DESKTOP_NAME: z.string().max(100).optional(),
  /** The desktop app's Google OAuth client, for sync through Google Drive (ADR 0006). */
  MEMORA_GOOGLE_CLIENT_ID: z
    .string()
    .regex(/^[\w.-]+\.apps\.googleusercontent\.com$/)
    .optional(),
  MEMORA_GOOGLE_CLIENT_SECRET: z.string().max(200).optional(),
});

/** Addresses only this computer can reach: the desktop app listens on nothing else. */
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

export interface Config {
  nodeEnv: 'development' | 'production' | 'test';
  host: string;
  port: number;
  dataDir: string;
  databaseFile: string;
  backupDir: string;
  webDir: string;
  baseUrl: string | undefined;
  logLevel: (typeof logLevels)[number];
  /** Idle timeout of a session with "remember this device" (sliding). */
  sessionRememberMs: number;
  /** Idle timeout of a session without it (sliding). */
  sessionMs: number;
  /**
   * Which proxies may set X-Forwarded-For/-Proto (Fastify `trustProxy`): `true`, `false`, a hop
   * count, or a comma-separated list of addresses, CIDR ranges and the presets `loopback`,
   * `linklocal` and `uniquelocal` (private networks, such as Docker's bridge and a NAS's
   * reverse proxy). Needed for correct client IPs in rate limits and sessions.
   */
  trustProxy: boolean | number | string[];
  /** Largest file a user can paste or upload into a page, in bytes. */
  maxUploadBytes: number;
  /** How long deleted items stay in the recycle bin. */
  trashMs: number;
  /** Which page versions are kept (§9.7). */
  historyRetention: RetentionRules;
  /**
   * The instance's secret key (made on first start): it encrypts what must not be readable
   * from the database alone, such as two-step verification secrets.
   */
  secretKeyFile: string;
  /** When backups are taken, or null for never (`MEMORA_BACKUP_SCHEDULE=off`). */
  backupSchedule: Schedule | null;
  /** How many daily, weekly and monthly backups are kept. */
  backupKeep: { daily: number; weekly: number; monthly: number };
  /** A file (a Docker secret) with the password that encrypts backups; none: not encrypted. */
  backupPasswordFile: string | undefined;
  /** Largest file that can be imported (a `.memora` archive or a zip), in bytes. */
  maxImportBytes: number;
  /** A Gotenberg service that makes PDFs (§9.10); none: the browser prints them. */
  gotenbergUrl: string | undefined;
  /**
   * Set when the desktop app runs this server (Phase 14): one person on one computer. There
   * are no passwords: the app's window signs in with `token`, a secret made at each launch,
   * and the owner's account is made on the first start, named `name`.
   */
  desktop: { token: string; name: string } | null;
  /**
   * The Google OAuth client ("Desktop app") the desktop app signs in to Google Drive with, for
   * sync (ADR 0006). Added to builds by CI; none: Google Drive needs a client of your own.
   */
  googleClient: { clientId: string; clientSecret?: string } | null;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Reads the configuration from environment variables (documented in docs/SETUP.md).
 * Empty values count as "not set", so `MEMORA_BASE_URL=` in a compose file behaves like leaving it out.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const provided = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const parsed = envSchema.safeParse(provided);
  if (!parsed.success) {
    throw new ConfigError(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const setting = <T>(name: string, read: () => T): T => {
    try {
      return read();
    } catch (error) {
      throw new ConfigError(`Invalid configuration:\n✖ ${name}: ${(error as Error).message}`);
    }
  };
  const historyRetention =
    e.MEMORA_HISTORY_RETENTION === '48h,14d,90d'
      ? DEFAULT_RETENTION
      : setting('MEMORA_HISTORY_RETENTION', () => parseRetention(e.MEMORA_HISTORY_RETENTION));
  const backupSchedule = /^(off|none|false)$/i.test(e.MEMORA_BACKUP_SCHEDULE.trim())
    ? null
    : setting('MEMORA_BACKUP_SCHEDULE', () => parseSchedule(e.MEMORA_BACKUP_SCHEDULE));
  const [daily = 7, weekly = 4, monthly = 12] = e.MEMORA_BACKUP_KEEP.split(',').map(Number);
  if (e.MEMORA_DESKTOP_TOKEN && !LOOPBACK.has(e.HOST)) {
    throw new ConfigError(
      'Invalid configuration:\n✖ HOST: the desktop app listens on this computer only (127.0.0.1).',
    );
  }

  // Production (Docker) keeps everything in the /data volume; development uses ./data (gitignored).
  const dataDir = resolve(e.MEMORA_DATA_DIR ?? (e.NODE_ENV === 'production' ? '/data' : 'data'));

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    dataDir,
    databaseFile: join(dataDir, 'memora.db'),
    backupDir: resolve(e.MEMORA_BACKUP_DIR ?? join(dataDir, 'backups')),
    webDir: resolve(e.MEMORA_WEB_DIR ?? defaultWebDir),
    baseUrl: e.MEMORA_BASE_URL,
    logLevel: e.MEMORA_LOG_LEVEL,
    sessionRememberMs: e.MEMORA_SESSION_DAYS * 24 * 3_600_000,
    sessionMs: e.MEMORA_SESSION_HOURS * 3_600_000,
    trustProxy: parseTrustProxy(e.MEMORA_TRUST_PROXY),
    maxUploadBytes: e.MEMORA_MAX_UPLOAD_MB * 1024 * 1024,
    trashMs: e.MEMORA_TRASH_DAYS * 24 * 3_600_000,
    historyRetention,
    backupSchedule,
    backupKeep: { daily, weekly, monthly },
    backupPasswordFile: e.MEMORA_BACKUP_PASSWORD_FILE,
    maxImportBytes: e.MEMORA_MAX_IMPORT_MB * 1024 * 1024,
    gotenbergUrl: e.MEMORA_GOTENBERG_URL?.replace(/\/+$/, ''),
    secretKeyFile: resolve(e.MEMORA_SECRET_KEY_FILE ?? join(dataDir, 'secret.key')),
    desktop: e.MEMORA_DESKTOP_TOKEN
      ? { token: e.MEMORA_DESKTOP_TOKEN, name: e.MEMORA_DESKTOP_NAME?.trim() || 'Me' }
      : null,
    googleClient: e.MEMORA_GOOGLE_CLIENT_ID
      ? {
          clientId: e.MEMORA_GOOGLE_CLIENT_ID,
          ...(e.MEMORA_GOOGLE_CLIENT_SECRET ? { clientSecret: e.MEMORA_GOOGLE_CLIENT_SECRET } : {}),
        }
      : null,
  };
}

function parseTrustProxy(value: string): boolean | number | string[] {
  const v = value.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false' || v === 'none') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return v
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}
