import {
  isRichContent,
  markdownToText,
  merge3,
  richToText,
  uuidv7,
  type PageType,
} from '@memora/shared';
import type { SqliteDatabase } from '../db/client';
import { indexPageLinks } from '../notes/links';
import type { Change } from './format';
import { later, ZERO_HLC, type Hlc } from './hlc';
import { keyOf, type Table } from './tables';

/*
 * The heart of sync (ADR 0006): turning rows changed here into changes, and merging changes
 * from other computers into this database.
 *
 * - Each group of columns of each row has a clock; the later change wins.
 * - A row changed here and not sent yet keeps its changes (they'll be sent with a later clock);
 *   the rest of the incoming row is taken. Markdown pages changed on both sides are merged;
 *   otherwise the other side's text is kept as a conflict version. Nothing is lost.
 * - A deletion wins over changes made before it; a row added again after it comes back.
 * - Rows whose parent hasn't arrived wait in `sync_parked`, for up to 30 days.
 *
 * Everything here is synchronous and runs in transactions: requests never see half a merge.
 */

type Value = string | number | null;
type Row = Record<string, unknown>;
type Fields = Record<string, Value>;

interface Clock {
  born: string | null;
  clocks: Record<string, string>;
  deleted: string | null;
}

/** A change from another computer, with the name of the computer that made it. */
export interface Incoming {
  device: string;
  name: string;
  change: Change;
}

/** Rows sent in a batch, to settle once the batch is in the folder. */
interface Sent {
  tbl: string;
  key: string;
  ver: number;
  /** The row as sent (for its next base), or null for a deletion. */
  row: Row | null;
  groups: string[];
  full: boolean;
  h: string;
}

export interface Outgoing {
  changes: Change[];
  sent: Sent[];
  /** Files (by SHA-256) the batch refers to: they go in the folder first. */
  blobs: string[];
  /** Rows still waiting after this batch. */
  more: boolean;
}

/** Where a snapshot being written has got to. */
export interface SnapshotPosition {
  /** Index in the synced tables, in their order. */
  table: number;
  /** The last rowid read (of the table, or of its clocks for deletions). */
  after: number;
  deletions: boolean;
}

export interface Applied {
  changes: number;
  parked: number;
  tree: boolean;
  kanban: boolean;
  templates: boolean;
  settings: boolean;
  /** Pages whose text changed. */
  pages: Set<string>;
  /** The first change that couldn't be applied (it waits, and is tried again), for the log. */
  failed?: { table: string; error: unknown };
}

const TREE = new Set(['notebooks', 'section_groups', 'sections', 'pages', 'tags', 'page_tags']);
const KANBAN = new Set([
  'projects',
  'boards',
  'board_columns',
  'swimlanes',
  'cards',
  'labels',
  'card_labels',
  'checklists',
  'checklist_items',
  'card_comments',
  'card_pages',
  'card_attachments',
  'card_activity',
]);

/** How long a change waits for the row it needs before it is dropped. */
export const PARK_DAYS = 30;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

const textOf = (type: PageType, content: string) =>
  type === 'markdown' ? markdownToText(content) : richToText(content);

function jsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

const isValue = (value: unknown): value is Value =>
  value === null ||
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value));

export interface EngineOptions {
  db: SqliteDatabase;
  tables: Map<string, Table>;
  /** This computer's account: every row here belongs to it. */
  owner: string;
  /** This computer's name, for the versions its side of a conflict is kept in. */
  deviceName: string;
  hlc: Hlc;
  now: () => number;
}

export class SyncEngine {
  private readonly db: SqliteDatabase;
  private readonly tables: Map<string, Table>;
  private readonly owner: string;
  private readonly hlc: Hlc;
  private readonly now: () => number;
  private readonly deviceName: string;

  constructor(options: EngineOptions) {
    this.db = options.db;
    this.tables = options.tables;
    this.owner = options.owner;
    this.hlc = options.hlc;
    this.now = options.now;
    this.deviceName = options.deviceName;
  }

  // Rows

  private ownerClause(table: Table): string {
    return table.owner.map((c) => ` AND ${quote(c)} = ?`).join('');
  }

  private selectColumns(table: Table): string {
    return table.columns
      .filter((c) => c.name !== table.blob)
      .map((c) => quote(c.name))
      .join(', ');
  }

  private select(table: Table, key: readonly Value[]): Row | undefined {
    const where = table.key.map((c) => `${quote(c)} = ?`).join(' AND ');
    return this.db
      .prepare(
        `SELECT ${this.selectColumns(table)} FROM ${quote(table.name)} WHERE ${where}${this.ownerClause(table)}`,
      )
      .get(...key, ...table.owner.map(() => this.owner)) as Row | undefined;
  }

  private exists(table: string, id: Value): boolean {
    return !!this.db.prepare(`SELECT 1 FROM ${quote(table)} WHERE id = ?`).get(id);
  }

  /** A row's fields as they travel: people as 1 or null, a JSON column key by key. */
  fieldsOf(table: Table, row: Row): Fields {
    const out: Fields = {};
    for (const name of table.fields) {
      if (table.json?.column === name) {
        const local = table.json.local[String(row[table.key[0]!])] ?? [];
        for (const [k, v] of Object.entries(jsonObject(row[name]))) {
          if (!local.includes(k) && v !== undefined) out[`${name}.${k}`] = JSON.stringify(v);
        }
        continue;
      }
      const value = row[name];
      if (table.people?.includes(name)) {
        out[name] = value === null || value === undefined ? null : 1;
      } else {
        out[name] = isValue(value) ? value : null;
      }
    }
    return out;
  }

  private groupOf(table: Table, field: string): string {
    return table.groupOf.get(field) ?? field;
  }

  /** The fields of a change that this database knows, with values it can store. */
  private known(table: Table, fields: Record<string, Value>): Fields {
    const out: Fields = {};
    for (const [name, value] of Object.entries(fields)) {
      if (!isValue(value)) continue;
      const json = table.json?.column;
      if (json && name.startsWith(`${json}.`)) {
        if (value === null || typeof value === 'string') out[name] = value;
      } else if (table.groupOf.has(name) && name !== json) {
        out[name] = value;
      }
    }
    return out;
  }

  /** Turns fields back into column values (for an insert or update). */
  private columnsOf(table: Table, fields: Fields, existing: Row | undefined): Row {
    const out: Row = {};
    const json = table.json;
    let doc: Record<string, unknown> | null = null;
    for (const [name, value] of Object.entries(fields)) {
      if (json && name.startsWith(`${json.column}.`)) {
        doc ??= jsonObject(existing?.[json.column]);
        const k = name.slice(json.column.length + 1);
        // Never an object's own machinery, whatever another computer sends.
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (value === null) delete doc[k];
        else {
          try {
            doc[k] = JSON.parse(String(value)) as unknown;
          } catch {
            // Not JSON: leave the key as it was.
          }
        }
        continue;
      }
      if (table.people?.includes(name)) {
        out[name] = value === null ? null : this.owner;
        continue;
      }
      out[name] = value;
    }
    if (json && doc) out[json.column] = JSON.stringify(doc);
    return out;
  }

  // Clocks, dirty rows, aliases

  private clock(tbl: string, key: string): Clock | undefined {
    const row = this.db
      .prepare('SELECT born, clocks, deleted FROM sync_clock WHERE tbl = ? AND key = ?')
      .get(tbl, key) as { born: string | null; clocks: string; deleted: string | null } | undefined;
    if (!row) return undefined;
    return {
      born: row.born,
      clocks: jsonObject(row.clocks) as Record<string, string>,
      deleted: row.deleted,
    };
  }

  private setClock(tbl: string, key: string, clock: Clock): void {
    this.db
      .prepare(
        `INSERT INTO sync_clock (tbl, key, born, clocks, deleted) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tbl, key) DO UPDATE SET born = excluded.born, clocks = excluded.clocks, deleted = excluded.deleted`,
      )
      .run(tbl, key, clock.born, JSON.stringify(clock.clocks), clock.deleted);
  }

  private dirty(tbl: string, key: string): { base: string | null; ver: number } | undefined {
    return this.db
      .prepare('SELECT base, ver FROM sync_dirty WHERE tbl = ? AND key = ?')
      .get(tbl, key) as { base: string | null; ver: number } | undefined;
  }

  private alias(tbl: string, key: string): string | undefined {
    return (
      this.db
        .prepare('SELECT to_key FROM sync_alias WHERE tbl = ? AND from_key = ?')
        .get(tbl, key) as { to_key: string } | undefined
    )?.to_key;
  }

  private setAlias(tbl: string, from: string, to: string): void {
    this.db
      .prepare(
        'INSERT INTO sync_alias (tbl, from_key, to_key) VALUES (?, ?, ?) ON CONFLICT (tbl, from_key) DO UPDATE SET to_key = excluded.to_key',
      )
      .run(tbl, from, to);
  }

  private setMute(on: boolean): void {
    if (on)
      this.db.prepare("INSERT OR IGNORE INTO sync_state (key, value) VALUES ('mute', '1')").run();
    else this.db.prepare("DELETE FROM sync_state WHERE key = 'mute'").run();
  }

  /** Runs `fn` with changes captured (as if made here), inside a muted apply. */
  private captured<T>(fn: () => T): T {
    this.setMute(false);
    try {
      return fn();
    } finally {
      this.setMute(true);
    }
  }

  // Outgoing

  /** Rows changed here and not sent yet. */
  waiting(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM sync_dirty').get() as { n: number }).n;
  }

  /**
   * The next batch of changes made here: up to `limit` rows or about `maxBytes` of JSON, parents
   * before children. Nothing is settled until `sent` is called for it.
   */
  collect(limit = 4000, maxBytes = 8_000_000): Outgoing {
    const entries = (
      this.db.prepare('SELECT tbl, key, ver FROM sync_dirty').all() as {
        tbl: string;
        key: string;
        ver: number;
      }[]
    )
      .filter((e) => this.tables.has(e.tbl))
      .sort((a, b) => this.tables.get(a.tbl)!.order - this.tables.get(b.tbl)!.order);
    // Rows of tables this version doesn't sync (any more) are dropped.
    this.db
      .prepare(
        `DELETE FROM sync_dirty WHERE tbl NOT IN (${[...this.tables.keys()].map(() => '?').join(', ')})`,
      )
      .run(...this.tables.keys());

    const out: Outgoing = { changes: [], sent: [], blobs: [], more: false };
    const unchanged: { tbl: string; key: string; ver: number }[] = [];
    let bytes = 0;
    for (const entry of entries) {
      if (out.changes.length >= limit || bytes >= maxBytes) {
        out.more = true;
        break;
      }
      const table = this.tables.get(entry.tbl)!;
      const key = JSON.parse(entry.key) as Value[];
      const row = this.select(table, key);
      const known = this.clock(entry.tbl, entry.key);
      const h = this.hlc.tickAfter(
        Object.values(known?.clocks ?? {}).reduce(
          (a, b) => later(a, b),
          later(known?.born, known?.deleted),
        ),
      );
      let change: Change;
      let sent: Sent;
      if (!row) {
        change = { t: table.name, k: key as (string | number)[], h, op: 'del' };
        sent = { ...entry, row: null, groups: [], full: false, h };
      } else {
        const base = (
          this.db
            .prepare('SELECT base FROM sync_dirty WHERE tbl = ? AND key = ?')
            .get(entry.tbl, entry.key) as { base: string | null } | undefined
        )?.base;
        const now = this.fieldsOf(table, row);
        if (base === null || base === undefined) {
          change = {
            t: table.name,
            k: key as (string | number)[],
            h,
            op: 'put',
            full: true,
            f: now,
          };
          sent = { ...entry, row, groups: [], full: true, h };
        } else {
          const before = this.fieldsOf(table, jsonObject(base));
          const groups = new Set<string>();
          for (const name of new Set([...Object.keys(now), ...Object.keys(before)])) {
            if ((now[name] ?? null) !== (before[name] ?? null))
              groups.add(this.groupOf(table, name));
          }
          if (groups.size === 0) {
            unchanged.push(entry);
            continue;
          }
          const f: Fields = {};
          for (const name of new Set([...Object.keys(now), ...Object.keys(before)])) {
            if (groups.has(this.groupOf(table, name))) f[name] = now[name] ?? null;
          }
          change = { t: table.name, k: key as (string | number)[], h, op: 'put', f };
          sent = { ...entry, row, groups: [...groups], full: false, h };
        }
        if (table.blob && change.op === 'put') out.blobs.push(String(key[0]));
      }
      bytes += JSON.stringify(change).length;
      out.changes.push(change);
      out.sent.push(sent);
    }
    if (unchanged.length) {
      this.db.transaction(() => {
        const drop = this.db.prepare(
          'DELETE FROM sync_dirty WHERE tbl = ? AND key = ? AND ver = ?',
        );
        for (const e of unchanged) drop.run(e.tbl, e.key, e.ver);
      })();
    }
    return out;
  }

  /** Settles a batch that is now in the folder: the rows' clocks, and what is left to send. */
  sent(batch: Outgoing): void {
    this.db.transaction(() => {
      for (const s of batch.sent) {
        const now = this.dirty(s.tbl, s.key);
        if (now && now.ver === s.ver) {
          this.db.prepare('DELETE FROM sync_dirty WHERE tbl = ? AND key = ?').run(s.tbl, s.key);
        } else if (now) {
          // Changed again while the batch was on its way: what was sent is the new base.
          this.db
            .prepare('UPDATE sync_dirty SET base = ? WHERE tbl = ? AND key = ?')
            .run(s.row ? JSON.stringify(s.row) : null, s.tbl, s.key);
        }
        const clock = this.clock(s.tbl, s.key) ?? { born: null, clocks: {}, deleted: null };
        if (!s.row) clock.deleted = later(clock.deleted, s.h);
        else if (s.full) {
          clock.born = s.h;
          clock.clocks = {};
          clock.deleted = null;
        } else {
          for (const g of s.groups) clock.clocks[g] = later(clock.clocks[g], s.h);
        }
        this.setClock(s.tbl, s.key, clock);
      }
    })();
  }

  /** A stored file's bytes, to put in the folder. */
  blobData(sha256: string): Buffer | undefined {
    const table = this.tables.get('asset_blobs');
    if (!table?.blob) return undefined;
    const row = this.db
      .prepare(
        `SELECT ${quote(table.blob)} AS data FROM asset_blobs WHERE sha256 = ?${this.ownerClause(table)}`,
      )
      .get(sha256, ...table.owner.map(() => this.owner)) as { data: Buffer } | undefined;
    return row?.data;
  }

  // Incoming

  /** Files the incoming (and waiting) changes need that this computer doesn't have. */
  wantedBlobs(incoming: readonly Incoming[]): string[] {
    const table = this.tables.get('asset_blobs');
    if (!table) return [];
    const parked = (
      this.db.prepare("SELECT change FROM sync_parked WHERE tbl = 'asset_blobs'").all() as {
        change: string;
      }[]
    ).map((p) => JSON.parse(p.change) as Change);
    const wanted = new Set<string>();
    for (const change of [...incoming.map((i) => i.change), ...parked]) {
      if (change.t !== 'asset_blobs' || change.op !== 'put' || typeof change.k[0] !== 'string')
        continue;
      if (!/^[0-9a-f]{64}$/.test(change.k[0])) continue;
      if (!this.select(table, [change.k[0]])) wanted.add(change.k[0]);
    }
    return [...wanted];
  }

  /**
   * Merges changes from other computers (and those still waiting from before), in one
   * transaction. `blobs` has the files they need, by SHA-256 (already checked).
   */
  apply(
    incoming: readonly Incoming[],
    options: { blobs?: Map<string, Buffer>; joining?: boolean } = {},
  ): Applied {
    const result: Applied = {
      changes: 0,
      parked: 0,
      tree: false,
      kanban: false,
      templates: false,
      settings: false,
      pages: new Set(),
    };
    const blobs = options.blobs ?? new Map<string, Buffer>();
    this.db.transaction(() => {
      this.setMute(true);
      const parked = (
        this.db.prepare('SELECT device, change, parked_at FROM sync_parked').all() as {
          device: string;
          change: string;
          parked_at: number;
        }[]
      ).map((p) => ({
        device: p.device,
        name: '',
        change: JSON.parse(p.change) as Change,
        parkedAt: p.parked_at,
      }));
      this.db.prepare('DELETE FROM sync_parked').run();
      let pending: (Incoming & { parkedAt: number | null })[] = [
        ...parked,
        ...incoming.map((i) => ({ ...i, parkedAt: null })),
      ].sort((a, b) => {
        const order =
          (this.tables.get(a.change.t)?.order ?? 999) - (this.tables.get(b.change.t)?.order ?? 999);
        return order !== 0 ? order : a.change.h < b.change.h ? -1 : a.change.h > b.change.h ? 1 : 0;
      });
      const post: (() => void)[] = [];
      // Rows wait for their parents; parents of the same table may come later in the list.
      for (let progress = true; progress && pending.length > 0;) {
        progress = false;
        const next: typeof pending = [];
        for (const item of pending) {
          let outcome: 'done' | 'skip' | 'wait';
          try {
            // Each change on its own (a savepoint): one that fails leaves no half of itself,
            // and waits instead of holding up the others.
            outcome = this.db.transaction(() =>
              this.applyOne(item, result, post, blobs, options.joining ?? false),
            )();
          } catch (error) {
            result.failed ??= { table: item.change.t, error };
            outcome = 'wait';
          }
          if (outcome === 'wait') next.push(item);
          else {
            progress = true;
            if (outcome === 'done') result.changes += 1;
          }
        }
        pending = next;
      }
      const cutoff = this.now() - PARK_DAYS * 24 * 3_600_000;
      const park = this.db.prepare(
        'INSERT INTO sync_parked (tbl, key, device, change, parked_at) VALUES (?, ?, ?, ?, ?)',
      );
      for (const item of pending) {
        const at = item.parkedAt ?? this.now();
        if (at < cutoff) continue;
        park.run(
          item.change.t,
          JSON.stringify(item.change.k),
          item.device,
          JSON.stringify(item.change),
          at,
        );
        result.parked += 1;
      }
      this.setMute(false);
      for (const fn of post) {
        try {
          this.db.transaction(fn)();
        } catch (error) {
          result.failed ??= { table: 'page_versions', error };
        }
      }
      if (result.tree) this.repairTree();
      if (result.kanban) this.repairCards();
    })();
    return result;
  }

  private touched(table: Table, result: Applied): void {
    if (TREE.has(table.name)) result.tree = true;
    if (KANBAN.has(table.name)) result.kanban = true;
    if (table.name === 'templates') result.templates = true;
    if (table.name === 'user_settings') result.settings = true;
  }

  /**
   * Puts the values that refer to other rows through the aliases (tags merged by name, the
   * inbox). Answers whether one changed.
   */
  private translate(table: Table, values: Row): boolean {
    let changed = false;
    for (const fk of table.parents) {
      const value = values[fk.column];
      if (value === null || value === undefined) continue;
      const to = this.alias(fk.table, JSON.stringify([value]));
      if (to) {
        values[fk.column] = (JSON.parse(to) as Value[])[0];
        changed = true;
      }
    }
    return changed;
  }

  private parentsExist(table: Table, values: Row): boolean {
    return table.parents.every((fk) => {
      const value = values[fk.column];
      return value === null || value === undefined || this.exists(fk.table, value as Value);
    });
  }

  /** Whether a row the values refer to was deleted for good (not just not here yet). */
  private parentGone(table: Table, values: Row): boolean {
    return table.parents.some((fk) => {
      const value = values[fk.column];
      if (value === null || value === undefined || this.exists(fk.table, value as Value)) {
        return false;
      }
      return !!this.clock(fk.table, JSON.stringify([value]))?.deleted;
    });
  }

  /** Deletes a row (and, through the database, what is in it), and notes when. */
  private deleteRow(table: Table, k: Value[], key: string, h: string, result: Applied): void {
    const where = table.key.map((c) => `${quote(c)} = ?`).join(' AND ');
    const { changes } = this.db
      .prepare(`DELETE FROM ${quote(table.name)} WHERE ${where}${this.ownerClause(table)}`)
      .run(...k, ...table.owner.map(() => this.owner));
    if (changes > 0) {
      this.db.prepare('DELETE FROM sync_dirty WHERE tbl = ? AND key = ?').run(table.name, key);
      this.touched(table, result);
    }
    const clock = this.clock(table.name, key);
    this.setClock(table.name, key, {
      born: clock?.born ?? null,
      clocks: clock?.clocks ?? {},
      deleted: later(clock?.deleted, h),
    });
  }

  private applyOne(
    item: Incoming,
    result: Applied,
    post: (() => void)[],
    blobs: Map<string, Buffer>,
    joining: boolean,
  ): 'done' | 'skip' | 'wait' {
    const { change } = item;
    const table = this.tables.get(change.t);
    if (!table || change.k.length !== table.key.length) return 'skip';
    this.hlc.observe(change.h);
    // Left by a change that failed half-way (its savepoint was rolled back): not this one's.
    this.pendingTagMerge = null;
    this.pendingKey = null;

    // A row merged into another here (another computer's inbox, a tag of the same name) is
    // done with: what is said of it under its old key is for the row that was dropped.
    const keyValues: Row = Object.fromEntries(table.key.map((c, i) => [c, change.k[i]]));
    if (this.alias(table.name, keyOf(table, keyValues))) return 'done';
    // Key columns that refer to such a row refer to the one it was merged into.
    const translated = this.translate(table, keyValues);
    const key = keyOf(table, keyValues);
    const k = table.key.map((c) => keyValues[c] as Value);
    const clock = this.clock(table.name, key);
    const row = this.select(table, k);

    if (change.op === 'del') {
      // Deleting a row under a merged key (a tag's page, as the tag was merged into another on
      // its computer) isn't deleting the row it is here.
      if (translated) return 'done';
      if (clock?.deleted && clock.deleted >= change.h) return 'done';
      if (row && (clock?.born ?? ZERO_HLC) > change.h) return 'done';
      this.deleteRow(table, k, key, change.h, result);
      return 'done';
    }

    const fields = this.known(table, change.f ?? {});
    this.translate(table, fields);
    const born = change.b ?? change.h;

    if (!row) {
      if (!change.full) return clock?.deleted ? 'done' : 'wait';
      if (clock?.deleted && clock.deleted >= born) return 'done';
      const values = { ...keyValues, ...fields };
      if (!this.parentsExist(table, values)) {
        if (!this.parentGone(table, values)) return 'wait';
        // Made in a row deleted for good elsewhere: deleted with it, as it is there (and its
        // later changes don't wait for it).
        this.deleteRow(table, k, key, born, result);
        return 'skip';
      }
      if (
        table.name === 'pages' &&
        fields.type === 'rich' &&
        !isRichContent(String(fields.content))
      ) {
        return 'skip';
      }
      let data: Buffer | undefined;
      if (table.blob) {
        data = blobs.get(String(k[0]));
        if (!data) return 'wait';
      }
      const settled = this.beforeInsert(table, keyValues, fields, key);
      if (settled) return settled;
      const columns: Row = {
        // A JSON column of keys that all stay on their computer still needs its object here.
        ...(table.json ? { [table.json.column]: '{}' } : {}),
        ...this.columnsOf(table, fields, undefined),
        ...keyValues,
        ...Object.fromEntries(table.owner.map((c) => [c, this.owner])),
        ...(table.blob ? { [table.blob]: data } : {}),
      };
      const names = Object.keys(columns).filter((n) => table.columnNames.has(n));
      this.db
        .prepare(
          `INSERT INTO ${quote(table.name)} (${names.map(quote).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        )
        .run(...names.map((n) => columns[n] as Value | Buffer));
      this.setClock(table.name, key, { born, clocks: { ...(change.c ?? {}) }, deleted: null });
      this.touched(table, result);
      if (table.name === 'pages') {
        indexPageLinks(
          this.db,
          String(k[0]),
          fields.type as PageType,
          String(fields.content ?? ''),
        );
        result.pages.add(String(k[0]));
      }
      this.afterWrite(table, k, fields);
      return 'done';
    }

    // The row is here: merge group by group.
    const dirty = this.dirty(table.name, key);
    const local = this.fieldsOf(table, row);
    const baseRow = dirty?.base ? jsonObject(dirty.base) : null;
    const base = baseRow ? this.fieldsOf(table, baseRow) : null;
    const allNames = base ? [...new Set([...Object.keys(local), ...Object.keys(base)])] : [];
    const changedHere = (group: string) =>
      !!dirty &&
      (base === null ||
        allNames.some(
          (n) => this.groupOf(table, n) === group && (local[n] ?? null) !== (base[n] ?? null),
        ));

    const byGroup = new Map<string, string[]>();
    for (const name of Object.keys(fields)) {
      const group = this.groupOf(table, name);
      byGroup.set(group, [...(byGroup.get(group) ?? []), name]);
    }
    const updates: Fields = {};
    const settledBase: Fields = {};
    const clocks = { ...(clock?.clocks ?? {}) };
    let pageText: { type: PageType; content: string } | null = null;
    for (const [group, names] of byGroup) {
      const remoteClock = change.c?.[group] ?? change.b ?? change.h;
      const localClock = clock?.clocks[group] ?? clock?.born ?? ZERO_HLC;
      if (table.max?.includes(group)) {
        const theirs = Number(fields[group] ?? 0);
        if (theirs > Number(local[group] ?? 0)) updates[group] = theirs;
        continue;
      }
      if (changedHere(group)) {
        if (table.name === 'pages' && group === 'type') {
          const merged = this.mergePageText(row, baseRow, fields, item, post);
          if (merged) pageText = merged;
        }
        // This computer's change stays, and goes out later; the other side becomes its base.
        for (const name of names) settledBase[name] = fields[name] ?? null;
        if (remoteClock > localClock) clocks[group] = remoteClock;
        continue;
      }
      if (remoteClock <= localClock) continue;
      if (table.name === 'pages' && group === 'type') {
        const type = fields.type as PageType;
        if (type === 'rich' && !isRichContent(String(fields.content))) continue;
        if (joining && !clock && fields.content !== row.content) {
          // This computer's text, from before it joined, is kept in the page's history.
          post.push(() =>
            this.keepVersion(row, row.type as PageType, String(row.content), this.deviceName),
          );
        }
        pageText = { type, content: String(fields.content ?? '') };
      }
      for (const name of names) {
        updates[name] = fields[name] ?? null;
        settledBase[name] = fields[name] ?? null;
      }
      clocks[group] = remoteClock;
    }

    if (pageText) {
      updates.type = pageText.type;
      updates.content = pageText.content;
      updates.content_text = textOf(pageText.type, pageText.content);
    }
    const columns = this.columnsOf(table, updates, row);
    const changed = Object.keys(columns).filter(
      (n) => table.columnNames.has(n) && (columns[n] ?? null) !== (row[n] ?? null),
    );
    if (changed.length > 0) {
      if (!this.parentsExist(table, columns)) {
        if (!this.parentGone(table, columns)) return 'wait';
        // Moved into a row deleted for good elsewhere: deleted with it, as it is there.
        this.deleteRow(table, k, key, change.h, result);
        return 'done';
      }
      if (this.beforeUpdate(table, k, columns, row)) return 'done';
      if (table.name === 'pages' && pageText) {
        columns.revision = Number(row.revision ?? 0) + 1;
        changed.push('revision');
      }
      const where = table.key.map((c) => `${quote(c)} = ?`).join(' AND ');
      this.db
        .prepare(
          `UPDATE ${quote(table.name)} SET ${changed.map((n) => `${quote(n)} = ?`).join(', ')} WHERE ${where}${this.ownerClause(table)}`,
        )
        .run(
          ...changed.map((n) => columns[n] as Value),
          ...k,
          ...table.owner.map(() => this.owner),
        );
      this.touched(table, result);
      if (table.name === 'pages' && pageText) {
        indexPageLinks(this.db, String(k[0]), pageText.type, pageText.content);
        result.pages.add(String(k[0]));
      }
      this.afterWrite(table, k, fields);
    }
    if (dirty && baseRow && Object.keys(settledBase).length > 0) {
      const next = { ...baseRow, ...this.columnsOf(table, settledBase, baseRow) };
      this.db
        .prepare('UPDATE sync_dirty SET base = ? WHERE tbl = ? AND key = ?')
        .run(JSON.stringify(next), table.name, key);
    }
    this.setClock(table.name, key, {
      born: clock?.born ?? (change.full ? born : null),
      clocks,
      deleted: null,
    });
    return 'done';
  }

  /**
   * A page's text changed here and on another computer. Markdown is merged when the edits
   * don't overlap; otherwise this computer's text stays and the other's becomes a version.
   */
  private mergePageText(
    row: Row,
    baseRow: Row | null,
    fields: Fields,
    item: Incoming,
    post: (() => void)[],
  ): { type: PageType; content: string } | null {
    const theirs = { type: fields.type as PageType, content: String(fields.content ?? '') };
    const mine = { type: row.type as PageType, content: String(row.content ?? '') };
    if (theirs.type === mine.type && theirs.content === mine.content) return null;
    if (baseRow?.type === 'markdown' && mine.type === 'markdown' && theirs.type === 'markdown') {
      const merged = merge3(String(baseRow.content ?? ''), theirs.content, mine.content);
      if (merged.ok)
        return merged.text === mine.content ? null : { type: 'markdown', content: merged.text };
    }
    if (theirs.type === 'rich' && !isRichContent(theirs.content)) return null;
    post.push(() =>
      this.keepVersion(row, theirs.type, theirs.content, item.name || 'another computer'),
    );
    return null;
  }

  /** Keeps text as a conflict version of the page (made as a change here, so it syncs too). */
  private keepVersion(row: Row, type: PageType, content: string, deviceLabel: string): void {
    // Deleted by a later change of the same round: nothing to keep it with.
    if (!this.exists('pages', row.id as string)) return;
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO page_versions (id, owner_id, page_id, revision, type, title, content, reason, name, device_label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'conflict', NULL, ?, ?)`,
      )
      .run(
        uuidv7(now),
        this.owner,
        row.id as string,
        Number(row.revision ?? 1),
        type,
        String(row.title ?? ''),
        content,
        deviceLabel.slice(0, 100),
        now,
      );
  }

  /**
   * Names that must be unique, before a new row goes in: a tag with a name taken here becomes
   * the older of the two; a project key taken here goes to the older project; another
   * computer's inbox is this one's. Answers 'done' when the row isn't inserted after all.
   */
  private beforeInsert(table: Table, keyValues: Row, fields: Fields, key: string): 'done' | null {
    const id = keyValues.id as string | undefined;
    if (table.name === 'sections' && Number(fields.is_inbox) === 1) {
      const inbox = this.db
        .prepare('SELECT id FROM sections WHERE owner_id = ? AND is_inbox = 1')
        .get(this.owner) as { id: string } | undefined;
      if (inbox && inbox.id !== id) {
        this.setAlias('sections', key, JSON.stringify([inbox.id]));
        return 'done';
      }
    }
    if (table.name === 'tags' && id && typeof fields.name_key === 'string') {
      const other = this.db
        .prepare('SELECT id FROM tags WHERE owner_id = ? AND name_key = ? AND id != ?')
        .get(this.owner, fields.name_key, id) as { id: string } | undefined;
      if (other) {
        if (other.id < id) {
          // The tag here is older: the incoming one is merged into it (its computer does the
          // same once it hears of this one, and sends its tag's deletion).
          this.setAlias('tags', key, JSON.stringify([other.id]));
          return 'done';
        }
        // The incoming tag is older: this computer's tag is merged into it once it is in.
        this.pendingTagMerge = { from: other.id, into: id };
        this.captured(() => {
          this.db
            .prepare('UPDATE tags SET name_key = ? WHERE id = ?')
            .run(`${other.id}\u0000`, other.id);
        });
      }
    }
    if (table.name === 'projects' && id && typeof fields.key === 'string') {
      const other = this.db
        .prepare('SELECT id FROM projects WHERE owner_id = ? AND key = ? AND id != ?')
        .get(this.owner, fields.key, id) as { id: string } | undefined;
      if (other) {
        if (other.id > id) {
          this.captured(() => this.giveFreeKey(other.id, fields.key as string));
        } else {
          // The incoming project is the newer: it takes a free key, which goes back out.
          this.pendingKey = { id, key: fields.key };
          fields.key = this.freeKey(fields.key);
        }
      }
    }
    return null;
  }

  private pendingTagMerge: { from: string; into: string } | null = null;
  /** A project inserted under another key than its computer gave it: that one, to send the new one. */
  private pendingKey: { id: string; key: string } | null = null;

  /**
   * Before an update: a tag renamed to a name another tag has merges into the older one; a
   * project key changed to a taken one goes to the older project. Answers true when the update
   * was handled here instead.
   */
  private beforeUpdate(table: Table, k: Value[], columns: Row, row: Row): boolean {
    const id = String(k[0]);
    if (
      table.name === 'tags' &&
      typeof columns.name_key === 'string' &&
      columns.name_key !== row.name_key
    ) {
      const other = this.db
        .prepare('SELECT id FROM tags WHERE owner_id = ? AND name_key = ? AND id != ?')
        .get(this.owner, columns.name_key, id) as { id: string } | undefined;
      if (other) {
        const [keep, drop] = other.id < id ? [other.id, id] : [id, other.id];
        this.captured(() => this.mergeTag(drop, keep));
        return keep === other.id;
      }
    }
    if (table.name === 'projects' && typeof columns.key === 'string' && columns.key !== row.key) {
      const other = this.db
        .prepare('SELECT id FROM projects WHERE owner_id = ? AND key = ? AND id != ?')
        .get(this.owner, columns.key, id) as { id: string } | undefined;
      if (other) {
        if (other.id > id) this.captured(() => this.giveFreeKey(other.id, columns.key as string));
        else {
          this.noteChange(table, k, { key: columns.key });
          columns.key = this.freeKey(columns.key);
        }
      }
    }
    return false;
  }

  /** Finishes what beforeInsert started, and keeps card numbers unique within a project. */
  private afterWrite(table: Table, k: Value[], fields: Fields): void {
    const id = String(k[0]);
    if (table.name === 'tags' && this.pendingTagMerge?.into === id) {
      const { from, into } = this.pendingTagMerge;
      this.pendingTagMerge = null;
      this.captured(() => this.mergeTag(from, into));
    }
    if (table.name === 'projects' && this.pendingKey?.id === id) {
      const { key: theirs } = this.pendingKey;
      this.pendingKey = null;
      // The other computers hear of the new key as a change made here.
      this.noteChange(table, k, { key: theirs });
    }
    if (table.name === 'cards' && ('number' in fields || 'board_id' in fields)) {
      this.renumberClash(id);
    }
  }

  /**
   * Notes a row as changed here, as if `base` (some of its columns) were how it was last synced:
   * for values sync itself changed (a free project key), which the other computers need too.
   */
  private noteChange(table: Table, k: Value[], base: Row): void {
    const row = this.select(table, k);
    if (!row) return;
    const key = JSON.stringify(k);
    const dirty = this.dirty(table.name, key);
    if (dirty && dirty.base === null) return;
    const before = { ...(dirty?.base ? jsonObject(dirty.base) : row), ...base };
    this.db
      .prepare(
        `INSERT INTO sync_dirty (tbl, key, base, ver) VALUES (?, ?, ?, 1)
         ON CONFLICT (tbl, key) DO UPDATE SET base = excluded.base, ver = ver + 1`,
      )
      .run(table.name, key, JSON.stringify(before));
  }

  /** Moves a tag's pages to another tag, and deletes it. */
  private mergeTag(from: string, into: string): void {
    const pagesOf = this.db.prepare('SELECT page_id FROM page_tags WHERE tag_id = ?').all(from) as {
      page_id: string;
    }[];
    this.db.prepare('DELETE FROM tags WHERE id = ?').run(from);
    const add = this.db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)');
    for (const p of pagesOf) add.run(p.page_id, into);
    this.setAlias('tags', JSON.stringify([from]), JSON.stringify([into]));
  }

  private freeKey(wanted: string): string {
    const clean = /^[A-Z][A-Z0-9]{1,9}$/.test(wanted) ? wanted : 'PRJ';
    const taken = new Set(
      (
        this.db.prepare('SELECT key FROM projects WHERE owner_id = ?').all(this.owner) as {
          key: string;
        }[]
      ).map((p) => p.key),
    );
    if (!taken.has(clean)) return clean;
    for (let n = 2; ; n += 1) {
      const candidate = `${clean.slice(0, 10 - String(n).length)}${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private giveFreeKey(projectId: string, wanted: string): void {
    this.db
      .prepare('UPDATE projects SET key = ? WHERE id = ?')
      .run(this.freeKey(wanted), projectId);
  }

  /** Two cards of a project with the same number: the newer one gets the project's next. */
  private renumberClash(cardId: string): void {
    const card = this.db
      .prepare(
        'SELECT c.id, c.number, b.project_id FROM cards c JOIN boards b ON b.id = c.board_id WHERE c.id = ?',
      )
      .get(cardId) as { id: string; number: number; project_id: string } | undefined;
    if (!card) return;
    const other = this.db
      .prepare(
        'SELECT c.id FROM cards c JOIN boards b ON b.id = c.board_id WHERE b.project_id = ? AND c.number = ? AND c.id != ?',
      )
      .get(card.project_id, card.number, card.id) as { id: string } | undefined;
    if (!other) return;
    const newer = other.id > card.id ? other.id : card.id;
    this.captured(() => {
      const project = this.db
        .prepare(
          'SELECT next_card_number AS next, (SELECT max(c.number) FROM cards c JOIN boards b ON b.id = c.board_id WHERE b.project_id = projects.id) AS top FROM projects WHERE id = ?',
        )
        .get(card.project_id) as { next: number; top: number | null };
      const number = Math.max(project.next, (project.top ?? 0) + 1);
      this.db.prepare('UPDATE cards SET number = ? WHERE id = ?').run(number, newer);
      this.db
        .prepare('UPDATE projects SET next_card_number = ? WHERE id = ?')
        .run(number + 1, card.project_id);
    });
  }

  // Repairs: what concurrent moves can leave behind, set right as changes made here.

  private repairTree(): void {
    const owner = this.owner;
    const db = this.db;
    // Groups: a parent in another notebook, or a loop.
    const groups = db
      .prepare('SELECT id, notebook_id, parent_group_id FROM section_groups WHERE owner_id = ?')
      .all(owner) as { id: string; notebook_id: string; parent_group_id: string | null }[];
    const setGroupParent = db.prepare(
      'UPDATE section_groups SET parent_group_id = NULL WHERE id = ?',
    );
    breakLoops(
      groups.map((g) => ({ id: g.id, parent: g.parent_group_id, scope: g.notebook_id })),
      (id) => setGroupParent.run(id),
    );
    db.prepare(
      `UPDATE sections SET group_id = NULL WHERE owner_id = ? AND group_id IS NOT NULL AND NOT EXISTS
       (SELECT 1 FROM section_groups g WHERE g.id = sections.group_id AND g.notebook_id = sections.notebook_id)`,
    ).run(owner);

    // Pages: loops, and subpages in another section than their parent.
    const pages = db
      .prepare('SELECT id, section_id, parent_page_id FROM pages WHERE owner_id = ?')
      .all(owner) as { id: string; section_id: string; parent_page_id: string | null }[];
    const setPageParent = db.prepare('UPDATE pages SET parent_page_id = NULL WHERE id = ?');
    breakLoops(
      pages.map((p) => ({ id: p.id, parent: p.parent_page_id, scope: null })),
      (id) => setPageParent.run(id),
    );
    const follow = db.prepare(
      `UPDATE pages SET section_id = (SELECT p.section_id FROM pages p WHERE p.id = pages.parent_page_id)
       WHERE owner_id = ? AND parent_page_id IS NOT NULL
         AND section_id != (SELECT p.section_id FROM pages p WHERE p.id = pages.parent_page_id)`,
    );
    for (let i = 0; i < 64 && follow.run(owner).changes > 0; i += 1);

    // Deleted parents: what is in them goes to the recycle bin with them.
    const inheritDeletion = [
      `UPDATE section_groups SET deleted_at = n.deleted_at, deleted_root_id = n.deleted_root_id
         FROM notebooks n WHERE n.id = section_groups.notebook_id AND section_groups.owner_id = ?
         AND section_groups.deleted_at IS NULL AND n.deleted_at IS NOT NULL`,
      `UPDATE section_groups SET deleted_at = g.deleted_at, deleted_root_id = g.deleted_root_id
         FROM section_groups g WHERE g.id = section_groups.parent_group_id AND section_groups.owner_id = ?
         AND section_groups.deleted_at IS NULL AND g.deleted_at IS NOT NULL`,
      `UPDATE sections SET deleted_at = n.deleted_at, deleted_root_id = n.deleted_root_id
         FROM notebooks n WHERE n.id = sections.notebook_id AND sections.owner_id = ?
         AND sections.deleted_at IS NULL AND n.deleted_at IS NOT NULL`,
      `UPDATE sections SET deleted_at = g.deleted_at, deleted_root_id = g.deleted_root_id
         FROM section_groups g WHERE g.id = sections.group_id AND sections.owner_id = ?
         AND sections.deleted_at IS NULL AND g.deleted_at IS NOT NULL`,
      `UPDATE pages SET deleted_at = s.deleted_at, deleted_root_id = s.deleted_root_id
         FROM sections s WHERE s.id = pages.section_id AND pages.owner_id = ?
         AND pages.deleted_at IS NULL AND s.deleted_at IS NOT NULL`,
      `UPDATE pages SET deleted_at = p.deleted_at, deleted_root_id = p.deleted_root_id
         FROM pages p WHERE p.id = pages.parent_page_id AND pages.owner_id = ?
         AND pages.deleted_at IS NULL AND p.deleted_at IS NOT NULL`,
    ].map((sql) => db.prepare(sql));
    for (let i = 0; i < 64; i += 1) {
      let changes = 0;
      for (const statement of inheritDeletion) changes += statement.run(owner).changes;
      if (changes === 0) break;
    }
  }

  private repairCards(): void {
    this.db
      .prepare(
        `UPDATE cards SET board_id = (SELECT c.board_id FROM board_columns c WHERE c.id = cards.column_id)
         WHERE owner_id = ? AND board_id != (SELECT c.board_id FROM board_columns c WHERE c.id = cards.column_id)`,
      )
      .run(this.owner);
    this.db
      .prepare(
        `UPDATE cards SET swimlane_id = NULL WHERE owner_id = ? AND swimlane_id IS NOT NULL AND NOT EXISTS
         (SELECT 1 FROM swimlanes s WHERE s.id = cards.swimlane_id AND s.board_id = cards.board_id)`,
      )
      .run(this.owner);
  }

  // Snapshots and joining

  /**
   * The next part of a snapshot (everything here, as changes with their clocks): the rows of
   * each table in turn, then its deletions, from `from`, up to about `maxBytes` of JSON. Read
   * in parts, with no query left open, so requests go on while a snapshot is written.
   */
  snapshotPage(
    from: SnapshotPosition | null,
    maxBytes = 8_000_000,
  ): { changes: Change[]; next: SnapshotPosition | null } {
    const tables = [...this.tables.values()].sort((a, b) => a.order - b.order);
    let pos: SnapshotPosition = from ?? { table: 0, after: 0, deletions: false };
    const changes: Change[] = [];
    let bytes = 0;
    while (pos.table < tables.length) {
      const table = tables[pos.table]!;
      if (!pos.deletions) {
        const rows = this.db
          .prepare(
            `SELECT rowid AS _rowid, ${this.selectColumns(table)} FROM ${quote(table.name)}
             WHERE rowid > ?${this.ownerClause(table)} ORDER BY rowid LIMIT 200`,
          )
          .all(pos.after, ...table.owner.map(() => this.owner)) as (Row & { _rowid: number })[];
        if (rows.length === 0) {
          pos = { table: pos.table, after: 0, deletions: true };
          continue;
        }
        for (const row of rows) {
          pos = { ...pos, after: row._rowid };
          const key = keyOf(table, row);
          // A row changed here since it was last sent is in the snapshot as it was then (the
          // change goes out in a batch after it); a new one isn't in it yet.
          const dirty = this.dirty(table.name, key);
          if (dirty && dirty.base === null) continue;
          const synced = dirty ? { ...row, ...jsonObject(dirty.base) } : row;
          const clock = this.clock(table.name, key);
          const born = clock?.born ?? ZERO_HLC;
          const c = clock?.clocks ?? {};
          const change: Change = {
            t: table.name,
            k: table.key.map((col) => row[col] as string | number),
            h: Object.values(c).reduce((a, b) => later(a, b), born),
            op: 'put',
            full: true,
            f: this.fieldsOf(table, synced),
            b: born,
            ...(Object.keys(c).length ? { c } : {}),
          };
          changes.push(change);
          bytes += JSON.stringify(change).length;
          if (bytes >= maxBytes) return { changes, next: pos };
        }
        continue;
      }
      const dead = this.db
        .prepare(
          'SELECT rowid AS _rowid, key, deleted FROM sync_clock WHERE tbl = ? AND deleted IS NOT NULL AND rowid > ? ORDER BY rowid LIMIT 500',
        )
        .all(table.name, pos.after) as { _rowid: number; key: string; deleted: string }[];
      if (dead.length === 0) {
        pos = { table: pos.table + 1, after: 0, deletions: false };
        continue;
      }
      for (const d of dead) {
        pos = { ...pos, after: d._rowid };
        const k = JSON.parse(d.key) as Value[];
        if (this.select(table, k)) continue;
        changes.push({ t: table.name, k: k as (string | number)[], h: d.deleted, op: 'del' });
        bytes += d.key.length + 80;
      }
      if (bytes >= maxBytes) return { changes, next: pos };
    }
    return { changes, next: null };
  }

  /**
   * Changes from other computers still waiting here for a row they need: a snapshot has them
   * too, as it says it has the batches they came in.
   */
  parkedChanges(): Change[] {
    return (
      this.db.prepare('SELECT change FROM sync_parked ORDER BY rowid').all() as { change: string }[]
    ).map((p) => JSON.parse(p.change) as Change);
  }

  /** Changes from other computers still waiting for a row they need. */
  parkedCount(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM sync_parked').get() as { n: number }).n;
  }

  /**
   * Joining a vault: this computer's inbox takes the vault's id, so the two are one inbox
   * (its pages go along). Nothing is captured; the rows are sent with everything else.
   */
  adoptInbox(vaultInbox: string): void {
    const inbox = this.db
      .prepare('SELECT id FROM sections WHERE owner_id = ? AND is_inbox = 1')
      .get(this.owner) as { id: string } | undefined;
    if (!inbox || inbox.id === vaultInbox) return;
    if (this.db.prepare('SELECT 1 FROM sections WHERE id = ?').get(vaultInbox)) return;
    this.db.transaction(() => {
      this.setMute(true);
      this.db.pragma('defer_foreign_keys = ON');
      this.db.prepare('UPDATE sections SET id = ? WHERE id = ?').run(vaultInbox, inbox.id);
      this.db
        .prepare('UPDATE pages SET section_id = ? WHERE section_id = ?')
        .run(vaultInbox, inbox.id);
      this.db
        .prepare('UPDATE pages SET deleted_root_id = ? WHERE deleted_root_id = ?')
        .run(vaultInbox, inbox.id);
      this.setMute(false);
    })();
  }

  /** Marks every row the vault doesn't know yet as new here, so it is sent whole. */
  markUnsynced(): number {
    let total = 0;
    this.db.transaction(() => {
      for (const table of this.tables.values()) {
        const key = `json_array(${table.key.map((c) => `t.${quote(c)}`).join(', ')})`;
        const owner = table.owner.map((c) => ` AND t.${quote(c)} = ?`).join('');
        total += this.db
          .prepare(
            `INSERT INTO sync_dirty (tbl, key, base, ver)
             SELECT ?, ${key}, NULL, 1 FROM ${quote(table.name)} t
             WHERE NOT EXISTS (SELECT 1 FROM sync_clock c WHERE c.tbl = ? AND c.key = ${key})${owner}
             ON CONFLICT (tbl, key) DO UPDATE SET base = NULL, ver = ver + 1`,
          )
          .run(table.name, table.name, ...table.owner.map(() => this.owner)).changes;
      }
    })();
    return total;
  }

  /** Forgets everything sync kept: turning it off, or after a restore. */
  reset(): void {
    this.db.transaction(() => {
      for (const table of ['sync_dirty', 'sync_clock', 'sync_parked', 'sync_alias']) {
        this.db.prepare(`DELETE FROM ${table}`).run();
      }
      this.setMute(false);
    })();
  }
}

/**
 * Breaks loops of parents (and parents in another scope): in each loop, the item with the
 * largest id (the newest) loses its parent.
 */
function breakLoops(
  items: { id: string; parent: string | null; scope: string | null }[],
  detach: (id: string) => void,
): void {
  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  for (const item of byId.values()) {
    if (item.parent === null) continue;
    const parent = byId.get(item.parent);
    if (!parent || (item.scope !== null && parent.scope !== item.scope)) {
      item.parent = null;
      detach(item.id);
    }
  }
  const done = new Set<string>();
  for (const start of byId.values()) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let current: typeof start | undefined = start;
    while (current && !done.has(current.id)) {
      if (onPath.has(current.id)) {
        const loop = path.slice(path.indexOf(current.id));
        const newest = loop.reduce((a, b) => (a > b ? a : b));
        byId.get(newest)!.parent = null;
        detach(newest);
        break;
      }
      onPath.add(current.id);
      path.push(current.id);
      current = current.parent === null ? undefined : byId.get(current.parent);
    }
    for (const id of path) done.add(id);
  }
}
