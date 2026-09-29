import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BackupInfo, BackupStatus, Tree, TreeChanges } from '@memora/shared';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPendingRestore, backupsToKeep } from '../backup/service';
import { DAY, createTestApp, type Client, type TestApp } from '../test/harness';

/*
 * Backups (§9.14), with the restore drill: back up, change things, restore, and find the
 * content exactly as it was when the backup was made.
 */

let t: TestApp;
afterEach(async () => {
  await t.close();
});

async function withPage(admin: Client, content: string) {
  const { inboxId } = (await admin.get('/api/v1/tree')).json() as Tree;
  const id = (
    (
      await admin.post('/api/v1/pages', { sectionId: inboxId, title: 'Plans' })
    ).json() as TreeChanges
  ).pages![0]!.id;
  await admin.put(`/api/v1/pages/${id}/content`, { baseRevision: 1, content });
  return id;
}

/** What the server would do on restart: close, put the backup in place, open again. */
async function restart(test: TestApp) {
  await test.app.close();
  test.db.close();
  const restored = applyPendingRestore(test.config.dataDir, test.config.databaseFile);
  return { restored, db: new Database(test.config.databaseFile, { readonly: true }) };
}

describe('backups', () => {
  it('makes, lists, downloads and restores a backup, backing up first', async () => {
    const onRestart = vi.fn();
    t = await createTestApp({ MEMORA_BACKUP_SCHEDULE: 'off' }, { onRestart });
    const admin = await t.setupAdmin('alex');
    const id = await withPage(admin, 'As it was');

    const made = await admin.post('/api/v1/admin/backups');
    expect(made.statusCode).toBe(201);
    const backup = made.json() as BackupInfo;
    expect(backup).toMatchObject({ kind: 'manual', encrypted: false });
    expect(backup.name).toMatch(/^memora-manual-2026-01-01T\d\d-\d\d-\d\d-\d{3}Z\.db$/);

    const status = (await admin.get('/api/v1/admin/backups')).json() as BackupStatus;
    expect(status).toMatchObject({ schedule: null, encrypting: false, last: { ok: true } });
    expect(status.backups.map((b) => b.name)).toContain(backup.name);

    const download = await admin.get(`/api/v1/admin/backups/${backup.name}`);
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-disposition']).toContain(backup.name);
    expect(download.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
    expect((await admin.get('/api/v1/admin/backups/..%2Fmemora.db')).statusCode).toBe(404);

    // Things change after the backup…
    await admin.put(`/api/v1/pages/${id}/content`, { baseRevision: 2, content: 'Changed since' });
    const restore = await admin.post(`/api/v1/admin/backups/${backup.name}/restore`);
    expect(restore.statusCode).toBe(200);
    expect(restore.json()).toMatchObject({ restarting: true });
    const safety = restore.json().safetyBackup as string;
    expect(safety).toMatch(/^memora-pre-restore-/);
    await vi.waitFor(() => expect(onRestart).toHaveBeenCalled());

    // …and after the restart the page is as it was, with the change kept in the safety backup.
    const { restored, db } = await restart(t);
    expect(restored).toBe(backup.name);
    expect(db.prepare('SELECT content FROM pages WHERE id = ?').get(id)).toEqual({
      content: 'As it was',
    });
    db.close();
    const saved = new Database(join(t.config.backupDir, safety), { readonly: true });
    expect(saved.prepare('SELECT content FROM pages WHERE id = ?').get(id)).toEqual({
      content: 'Changed since',
    });
    saved.close();
    // Nothing waits any more.
    expect(applyPendingRestore(t.config.dataDir, t.config.databaseFile)).toBeNull();
  });

  it('encrypts backups when a password file is set, and restores them', async () => {
    const dir = (await import('node:fs')).mkdtempSync(
      join((await import('node:os')).tmpdir(), 'pw-'),
    );
    const passwordFile = join(dir, 'backup_password');
    writeFileSync(passwordFile, 'a long backup password\n');
    t = await createTestApp(
      { MEMORA_BACKUP_SCHEDULE: 'off', MEMORA_BACKUP_PASSWORD_FILE: passwordFile },
      { onRestart: () => undefined },
    );
    const admin = await t.setupAdmin('alex');
    const id = await withPage(admin, 'Secret plans');
    const backup = (await admin.post('/api/v1/admin/backups')).json() as BackupInfo;
    expect(backup).toMatchObject({ encrypted: true });
    expect(backup.name).toMatch(/\.db\.enc$/);
    const bytes = readFileSync(join(t.config.backupDir, backup.name));
    expect(bytes.subarray(0, 10).toString()).toBe('MEMORAENC1');
    expect(bytes.includes(Buffer.from('Secret plans'))).toBe(false);

    // With the wrong password it can't be restored, and nothing is left waiting.
    writeFileSync(passwordFile, 'not the password');
    const wrong = await admin.post(`/api/v1/admin/backups/${backup.name}/restore`);
    expect(wrong.statusCode).toBe(422);
    expect(existsSync(join(t.config.dataDir, 'restore'))).toBe(false);

    writeFileSync(passwordFile, 'a long backup password');
    await admin.put(`/api/v1/pages/${id}/content`, { baseRevision: 2, content: 'Changed' });
    expect((await admin.post(`/api/v1/admin/backups/${backup.name}/restore`)).statusCode).toBe(200);
    const { db } = await restart(t);
    expect(db.prepare('SELECT content FROM pages WHERE id = ?').get(id)).toEqual({
      content: 'Secret plans',
    });
    db.close();
  });

  it('refuses to restore a damaged backup', async () => {
    t = await createTestApp({ MEMORA_BACKUP_SCHEDULE: 'off' });
    const admin = await t.setupAdmin('alex');
    (await import('node:fs')).mkdirSync(t.config.backupDir, { recursive: true });
    const name = 'memora-manual-2026-01-01T00-00-00-000Z.db';
    writeFileSync(join(t.config.backupDir, name), 'not a database at all');
    const res = await admin.post(`/api/v1/admin/backups/${name}/restore`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/can’t be restored/);
    expect(existsSync(join(t.config.dataDir, 'restore'))).toBe(false);
  });

  it('deletes a backup', async () => {
    t = await createTestApp({ MEMORA_BACKUP_SCHEDULE: 'off' });
    const admin = await t.setupAdmin('alex');
    const backup = (await admin.post('/api/v1/admin/backups')).json() as BackupInfo;
    expect((await admin.delete(`/api/v1/admin/backups/${backup.name}`)).statusCode).toBe(204);
    expect(existsSync(join(t.config.backupDir, backup.name))).toBe(false);
  });
});

describe('backup retention', () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const backup = (name: string, ago: number): BackupInfo => ({
    name,
    kind: 'scheduled',
    size: 1,
    createdAt: now - ago,
    encrypted: false,
  });

  it('keeps the last day, then daily, weekly and monthly ones', () => {
    // One backup a day for 100 days, plus two extra from this morning.
    const all = [
      backup('today-1', 2 * 3_600_000),
      backup('today-2', 3 * 3_600_000),
      ...Array.from({ length: 100 }, (_, i) => backup(`day-${i + 1}`, (i + 1) * DAY)),
    ];
    const kept = backupsToKeep(all, now, { daily: 7, weekly: 4, monthly: 12 });
    expect(kept.has('today-1') && kept.has('today-2')).toBe(true);
    for (let i = 1; i <= 6; i += 1) expect(kept.has(`day-${i}`), `day-${i}`).toBe(true);
    expect(kept.has('day-92')).toBe(true); // the newest of June, the oldest month
    // Far fewer than all of them.
    expect(kept.size).toBeLessThan(20);
  });
});
