import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/client';
import { runMigrations } from '../db/migrate';
import { migrationsDir } from '../paths';
import {
  blobName,
  createVault,
  parseVaultHeader,
  seal,
  sealJson,
  unlockVault,
  unseal,
  openJson,
  VaultError,
} from './crypto';
import { Hlc, ZERO_HLC } from './hlc';
import { pathParts } from './store';
import { FolderStore } from './stores/folder';
import { isLocalTable, readTables, SYNCED_TABLES } from './tables';

/* The pieces of sync (ADR 0006) on their own: clocks, the vault's encryption, paths, tables. */

describe('hybrid logical clocks', () => {
  it('keep increasing, and come after clocks heard from other computers', () => {
    let time = 1_000;
    const clock = new Hlc('aaaaaaaa-0000-7000-8000-000000000000', () => time);
    const first = clock.tick();
    const second = clock.tick();
    expect(second > first).toBe(true);
    time = 900; // this computer's clock went back
    expect(clock.tick() > second).toBe(true);
    clock.observe(`${String(5_000).padStart(16, '0')}:0007:bbbbbbbb-0000-7000-8000-000000000000`);
    expect(clock.tick() > `${String(5_000).padStart(16, '0')}:0007:bbbbbbbb`).toBe(true);
    expect(ZERO_HLC < first).toBe(true);
  });

  it('ignore clocks from far in the future', () => {
    const clock = new Hlc('aaaaaaaa', () => 1_000);
    clock.observe(`${String(1_000 + 2 * 86_400_000).padStart(16, '0')}:0000:bbbbbbbb`);
    expect(clock.tick().startsWith(String(1_000).padStart(16, '0'))).toBe(true);
  });

  it('come after a row’s clock for a change made to it, even one far ahead', () => {
    const clock = new Hlc('aaaaaaaa', () => 1_000);
    const ahead = `${String(1_000 + 2 * 86_400_000).padStart(16, '0')}:9999:bbbbbbbb`;
    const next = clock.tickAfter(ahead);
    expect(next > ahead).toBe(true);
    expect(next).toBe(`${String(1_000 + 2 * 86_400_000 + 1).padStart(16, '0')}:0000:aaaaaaaa`);
    // Without taking that clock in: later changes elsewhere aren't dragged ahead.
    expect(clock.tick().startsWith(String(1_000).padStart(16, '0'))).toBe(true);
    expect(clock.tickAfter(ZERO_HLC) > ZERO_HLC).toBe(true);
  });
});

describe('the vault’s encryption', () => {
  it('opens with the right passphrase only', async () => {
    const { header, keys } = await createVault('violet harbour lantern', 1_000);
    const parsed = parseVaultHeader(Buffer.from(JSON.stringify(header)));
    const again = await unlockVault(parsed, 'violet harbour lantern');
    expect(again.content.equals(keys.content)).toBe(true);
    await expect(unlockVault(parsed, 'violet harbour lanterns')).rejects.toThrow(VaultError);
  });

  it('refuses a vault made by a newer Memora, and files that aren’t one', () => {
    expect(() => parseVaultHeader(Buffer.from('{"format":"memora-sync","version":99}'))).toThrow(
      VaultError,
    );
    expect(() => parseVaultHeader(Buffer.from('not json'))).toThrow(VaultError);
  });

  it('refuses key settings that would take minutes or gigabytes to open', async () => {
    const { header } = await createVault('violet harbour lantern', 1_000);
    for (const kdf of [{ logN: 22 }, { r: 32 }, { p: 16 }]) {
      const heavy = { ...header, kdf: { ...header.kdf, ...kdf } };
      expect(() => parseVaultHeader(Buffer.from(JSON.stringify(heavy)))).toThrow(VaultError);
    }
  });

  it('binds each file to its place and kind: changed, moved or swapped files fail', async () => {
    const { keys } = await createVault('violet harbour lantern', 1_000);
    const sealed = sealJson(keys, 'changes/a.mchg', 'changes', { hello: 'world' });
    expect(openJson(keys, 'changes/a.mchg', 'changes', sealed)).toEqual({ hello: 'world' });
    expect(() => openJson(keys, 'changes/b.mchg', 'changes', sealed)).toThrow(VaultError);
    expect(() => unseal(keys, 'changes/a.mchg', 'snapshot', sealed)).toThrow(VaultError);
    const changed = Buffer.from(sealed);
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    expect(() => unseal(keys, 'changes/a.mchg', 'changes', changed)).toThrow(VaultError);
    const other = await createVault('violet harbour lantern', 1_000);
    expect(() => unseal(other.keys, 'changes/a.mchg', 'changes', sealed)).toThrow(VaultError);
    // The same content twice never looks the same.
    expect(
      seal(keys, 'x', 'blob', Buffer.from('same')).equals(
        seal(keys, 'x', 'blob', Buffer.from('same')),
      ),
    ).toBe(false);
  });

  it('names stored files without giving away what they hold', async () => {
    const { keys } = await createVault('violet harbour lantern', 1_000);
    const sha = 'a'.repeat(64);
    expect(blobName(keys, sha)).toMatch(/^[0-9a-f]{64}$/);
    expect(blobName(keys, sha)).not.toBe(sha);
  });
});

describe('vault paths', () => {
  it('are Memora’s own shapes, and nothing else', () => {
    expect(pathParts('memora-vault.json')).toEqual(['memora-vault.json']);
    expect(pathParts('changes/abc.0000000001.mchg')).toEqual(['changes', 'abc.0000000001.mchg']);
    for (const bad of [
      '../secret',
      'changes/../../x',
      '/etc/passwd',
      'changes\\x',
      'other/x',
      'changes/',
      'changes/.hidden',
      'files/a/b',
      'C:\\Windows',
      '',
    ]) {
      expect(() => pathParts(bad), bad).toThrow();
    }
  });
});

describe('a folder on this computer', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'memora-folder-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads, writes, lists and removes inside the folder only', async () => {
    const store = await FolderStore.open(dir);
    await store.write('changes/a.mchg', Buffer.from('one'));
    expect((await store.read('changes/a.mchg', 100))?.toString()).toBe('one');
    await expect(store.read('changes/a.mchg', 2)).rejects.toThrow(/too large/);
    expect(await store.create('changes/a.mchg', Buffer.from('two'))).toBe(false);
    expect((await store.read('changes/a.mchg', 100))?.toString()).toBe('one');
    expect(await store.create('changes/b.mchg', Buffer.from('two'))).toBe(true);
    await store.remove('changes/b.mchg');
    expect((await store.list('changes')).map((e) => e.name)).toEqual(['a.mchg']);
    expect(await store.read('changes/missing.mchg', 100)).toBeNull();
    expect(await store.list('files')).toEqual([]);
    await store.remove('changes/a.mchg');
    expect(await store.list('changes')).toEqual([]);
    await expect(store.read('../outside', 100)).rejects.toThrow();
  });

  it('passes over files it didn’t write: sync apps’ copies, half-written ones', async () => {
    const store = await FolderStore.open(dir);
    await store.write('changes/a.mchg', Buffer.from('one'));
    writeFileSync(join(dir, 'changes', 'a (1).mchg'), 'conflicted copy');
    writeFileSync(join(dir, 'changes', '.a.mchg.123.tmp'), 'half');
    expect((await store.list('changes')).map((e) => e.name)).toEqual(['a.mchg']);
  });

  it('needs an existing folder, by its full path', async () => {
    await expect(FolderStore.open('relative/path')).rejects.toThrow(/full path/);
    await expect(FolderStore.open(join(dir, 'missing'))).rejects.toThrow(/no folder/);
  });
});

describe('what syncs', () => {
  it('lists every table as synced or local', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memora-tables-'));
    const db = openDatabase(join(dir, 'memora.db'));
    await runMigrations({ db, migrationsDir, backupDir: join(dir, 'backups'), appVersion: 'test' });
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((t) => t.name);
    const synced = new Set(SYNCED_TABLES.map((t) => t.name));
    const unlisted = tables.filter((name) => !synced.has(name) && !isLocalTable(name));
    expect(unlisted, 'add new tables to SYNCED_TABLES or LOCAL_TABLES in sync/tables.ts').toEqual(
      [],
    );
    // Every synced table and column it names exists; parents come before their children.
    const read = readTables(db);
    for (const table of read.values()) {
      for (const parent of table.parents) {
        if (parent.table === table.name) continue;
        expect(read.get(parent.table)!.order, `${table.name} → ${parent.table}`).toBeLessThan(
          table.order,
        );
      }
    }
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
