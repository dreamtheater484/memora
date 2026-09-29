import { join, resolve } from 'node:path';
import { DEFAULT_MAX_UPLOAD_MB } from '@memora/shared';
import { z } from 'zod';
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
});

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
