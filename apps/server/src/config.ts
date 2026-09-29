import { join, resolve } from 'node:path';
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
  };
}
