import type { CreatePageRequest, PageMeta } from '@memora/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { settle, type PageRecord } from './records';

/*
 * This browser's copy of a user's pages (§9.6): one IndexedDB database per user, holding
 * the page records (the outbox is simply the records with unsent changes), changes to the
 * tree made offline, and the last tree and settings for starting without a connection.
 *
 * When IndexedDB can't be used (some private modes block it, or it fails later), a store in
 * memory takes over: saving still works while the tab is open, and the app says so.
 */

/** Something changed offline that isn't page content, sent before any content. */
export type Op =
  | {
      seq?: number;
      kind: 'createPage';
      body: CreatePageRequest & { id: string };
      /** The row shown in the tree until the server has the page. */
      meta: PageMeta;
    }
  | {
      seq?: number;
      /** Text that lost out to another tab's, kept on the server as a version. */
      kind: 'keepVersion';
      pageId: string;
      content: string;
      baseRevision: number;
    };

/** Changes a record inside one transaction: a new record, null to delete it, or undefined. */
export type Change = (record: PageRecord | undefined) => PageRecord | null | undefined;

export interface LocalStore {
  /** False for the in-memory stand-in: nothing survives the tab. */
  readonly durable: boolean;
  get(id: string): Promise<PageRecord | undefined>;
  /** Applies `change` atomically and answers the record as it is afterwards. */
  update(id: string, change: Change): Promise<PageRecord | undefined>;
  /** Records with something to send or settle. */
  dirty(): Promise<PageRecord[]>;
  /** How many records and ops wait, without reading them. */
  counts(): Promise<{ dirty: number; ops: number }>;
  ops(): Promise<Op[]>;
  addOp(op: Op): Promise<void>;
  /** Replaces an op (by its `seq`). */
  updateOp(op: Op): Promise<void>;
  removeOp(seq: number): Promise<void>;
  read<T>(key: string): Promise<T | undefined>;
  write(key: string, value: unknown): Promise<void>;
  /** Drops the least recently used unchanged pages beyond `keep`. */
  trim(keep: number): Promise<void>;
  /** Drops every unchanged page and the kept tree and settings (logging out). */
  forgetClean(): Promise<void>;
  close(): void;
}

interface Schema extends DBSchema {
  pages: { key: string; value: PageRecord; indexes: { dirty: number; touchedAt: number } };
  ops: { key: number; value: Op };
  kv: { key: string; value: unknown };
}

const VERSION = 1;

/** The per-user database's name. */
export const databaseName = (userId: string) => `memora-${userId}`;

class IdbStore implements LocalStore {
  readonly durable = true;

  constructor(private readonly db: IDBPDatabase<Schema>) {}

  get(id: string) {
    return this.db.get('pages', id);
  }

  async update(id: string, change: Change) {
    const tx = this.db.transaction('pages', 'readwrite');
    const current = await tx.store.get(id);
    const next = change(current);
    if (next === null) await tx.store.delete(id);
    else if (next) await tx.store.put(settle(next));
    await tx.done;
    return next === null ? undefined : next ? settle(next) : current;
  }

  dirty() {
    return this.db.getAllFromIndex('pages', 'dirty', 1);
  }

  async counts() {
    const [dirty, ops] = await Promise.all([
      this.db.countFromIndex('pages', 'dirty', 1),
      this.db.count('ops'),
    ]);
    return { dirty, ops };
  }

  ops() {
    return this.db.getAll('ops');
  }

  async addOp(op: Op) {
    await this.db.add('ops', op);
  }

  async updateOp(op: Op) {
    await this.db.put('ops', op);
  }

  async removeOp(seq: number) {
    await this.db.delete('ops', seq);
  }

  read<T>(key: string) {
    return this.db.get('kv', key) as Promise<T | undefined>;
  }

  async write(key: string, value: unknown) {
    await this.db.put('kv', value, key);
  }

  async trim(keep: number) {
    const tx = this.db.transaction('pages', 'readwrite');
    let seen = 0;
    // Newest first: the ones past `keep` are the oldest.
    for (
      let cursor = await tx.store.index('touchedAt').openCursor(null, 'prev');
      cursor;
      cursor = await cursor.continue()
    ) {
      if (cursor.value.dirty) continue;
      if (++seen > keep) await cursor.delete();
    }
    await tx.done;
  }

  async forgetClean() {
    const tx = this.db.transaction(['pages', 'kv'], 'readwrite');
    const pages = tx.objectStore('pages');
    for (
      let cursor = await pages.index('dirty').openCursor(0);
      cursor;
      cursor = await cursor.continue()
    ) {
      await cursor.delete();
    }
    await tx.objectStore('kv').clear();
    await tx.done;
  }

  close() {
    this.db.close();
  }
}

/** The stand-in when IndexedDB is unavailable: same behaviour, gone with the tab. */
export class MemoryStore implements LocalStore {
  readonly durable = false;
  private readonly pages = new Map<string, PageRecord>();
  private readonly opList: Op[] = [];
  private readonly kv = new Map<string, unknown>();
  private seq = 1;

  async get(id: string) {
    return this.pages.get(id);
  }

  async update(id: string, change: Change) {
    const next = change(this.pages.get(id));
    if (next === null) this.pages.delete(id);
    else if (next) this.pages.set(id, settle(next));
    return this.pages.get(id);
  }

  async dirty() {
    return [...this.pages.values()].filter((r) => r.dirty);
  }

  async counts() {
    return { dirty: (await this.dirty()).length, ops: this.opList.length };
  }

  async ops() {
    return [...this.opList];
  }

  async addOp(op: Op) {
    this.opList.push({ ...op, seq: this.seq++ });
  }

  async updateOp(op: Op) {
    const i = this.opList.findIndex((o) => o.seq === op.seq);
    if (i >= 0) this.opList[i] = op;
  }

  async removeOp(seq: number) {
    const i = this.opList.findIndex((op) => op.seq === seq);
    if (i >= 0) this.opList.splice(i, 1);
  }

  async read<T>(key: string) {
    return this.kv.get(key) as T | undefined;
  }

  async write(key: string, value: unknown) {
    this.kv.set(key, value);
  }

  async trim(keep: number) {
    const clean = [...this.pages.values()]
      .filter((r) => !r.dirty)
      .sort((a, b) => b.touchedAt - a.touchedAt);
    for (const r of clean.slice(keep)) this.pages.delete(r.id);
  }

  async forgetClean() {
    for (const r of [...this.pages.values()]) if (!r.dirty) this.pages.delete(r.id);
    this.kv.clear();
  }

  close() {}
}

/**
 * Opens the user's store. Falls back to memory when IndexedDB is missing or refuses (a
 * write is tried too: some browsers open the database and then fail every write).
 */
export async function openStore(userId: string): Promise<LocalStore> {
  if (typeof indexedDB === 'undefined') return new MemoryStore();
  try {
    const db = await openDB<Schema>(databaseName(userId), VERSION, {
      upgrade(db) {
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('dirty', 'dirty');
        pages.createIndex('touchedAt', 'touchedAt');
        db.createObjectStore('ops', { keyPath: 'seq', autoIncrement: true });
        db.createObjectStore('kv');
      },
      // Another tab has an older version open: let it go rather than block.
      blocking() {
        db.close();
      },
    });
    await db.put('kv', Date.now(), 'openedAt');
    return new IdbStore(db);
  } catch {
    return new MemoryStore();
  }
}
