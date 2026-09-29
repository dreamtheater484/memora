import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('uses /data in production', () => {
    const config = loadConfig({ NODE_ENV: 'production' });
    expect(config.dataDir).toBe(resolve('/data'));
    expect(config.databaseFile).toBe(join(resolve('/data'), 'memora.db'));
    expect(config.backupDir).toBe(join(resolve('/data'), 'backups'));
    expect(config.port).toBe(3000);
    expect(config.logLevel).toBe('info');
  });

  it('uses ./data during development', () => {
    expect(loadConfig({}).dataDir).toBe(resolve('data'));
  });

  it('treats empty values as unset', () => {
    const config = loadConfig({ NODE_ENV: 'production', PORT: '', MEMORA_BASE_URL: '  ' });
    expect(config.port).toBe(3000);
    expect(config.baseUrl).toBeUndefined();
  });

  it('honours explicit settings', () => {
    const config = loadConfig({
      PORT: '8080',
      MEMORA_DATA_DIR: '/srv/memora',
      MEMORA_BACKUP_DIR: '/backups',
      MEMORA_BASE_URL: 'https://notes.example.com',
      MEMORA_LOG_LEVEL: 'debug',
    });
    expect(config.port).toBe(8080);
    expect(config.dataDir).toBe(resolve('/srv/memora'));
    expect(config.backupDir).toBe(resolve('/backups'));
    expect(config.baseUrl).toBe('https://notes.example.com');
    expect(config.logLevel).toBe('debug');
  });

  it.each([
    ['PORT', '70000'],
    ['PORT', 'abc'],
    ['MEMORA_BASE_URL', 'ftp://notes.example.com'],
    ['MEMORA_LOG_LEVEL', 'loud'],
    ['MEMORA_TRASH_DAYS', '0'],
    ['MEMORA_HISTORY_RETENTION', '14d,48h,90d'],
    ['MEMORA_BACKUP_SCHEDULE', 'every night'],
    ['MEMORA_BACKUP_KEEP', '7,4'],
  ])('rejects an invalid %s (%s)', (key, value) => {
    expect(() => loadConfig({ [key]: value })).toThrow(ConfigError);
  });

  it('reads the history, recycle bin and backup settings', () => {
    const defaults = loadConfig({});
    expect(defaults.trashMs).toBe(30 * 24 * 3_600_000);
    expect(defaults.backupSchedule?.source).toBe('0 3 * * *');
    expect(defaults.backupKeep).toEqual({ daily: 7, weekly: 4, monthly: 12 });
    expect(defaults.backupPasswordFile).toBeUndefined();
    const set = loadConfig({
      MEMORA_TRASH_DAYS: '7',
      MEMORA_BACKUP_SCHEDULE: 'off',
      MEMORA_BACKUP_KEEP: '3, 2, 1',
      MEMORA_HISTORY_RETENTION: '24h,7d,30d',
    });
    expect(set.trashMs).toBe(7 * 24 * 3_600_000);
    expect(set.backupSchedule).toBeNull();
    expect(set.backupKeep).toEqual({ daily: 3, weekly: 2, monthly: 1 });
    expect(set.historyRetention.dailyMs).toBe(30 * 24 * 3_600_000);
  });
});
