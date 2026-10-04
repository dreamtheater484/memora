import type { SqliteDatabase } from '../db/client';

/*
 * What sync carries (ADR 0006): the synced tables in the order their rows are applied (parents
 * first), and what is special about each. Everything else stays on its computer. A table added
 * by a later migration must be listed in one of the two lists; `tables.test.ts` fails until it
 * is. Columns are read from the schema at run time, so a column added later syncs by itself.
 */

export interface TableSpec {
  name: string;
  /** The columns that name a row on every computer (the owner's column left out). */
  key: readonly string[];
  /** Columns holding this computer's account: never sent, set to the owner here. */
  owner: readonly string[];
  /** Columns naming a person (who wrote a comment): sent as 1 or null, the owner here. */
  people?: readonly string[];
  /** Columns each computer keeps for itself. */
  local?: readonly string[];
  /** Columns that only make sense together: they change, and win, as one. */
  groups?: readonly (readonly string[])[];
  /** A column whose bytes travel as a file of their own. */
  blob?: string;
  /** Columns merged by keeping the larger value (a counter). */
  max?: readonly string[];
  /** A JSON column merged key by key; `local` lists keys kept here, by the row's `key`. */
  json?: { column: string; local: Record<string, readonly string[]> };
}

const lifecycle = ['deleted_at', 'deleted_root_id'] as const;

export const SYNCED_TABLES: readonly TableSpec[] = [
  { name: 'notebooks', key: ['id'], owner: ['owner_id'], groups: [lifecycle] },
  {
    name: 'section_groups',
    key: ['id'],
    owner: ['owner_id'],
    groups: [['notebook_id', 'parent_group_id', 'sort_key'], lifecycle],
  },
  {
    name: 'sections',
    key: ['id'],
    owner: ['owner_id'],
    groups: [['notebook_id', 'group_id', 'sort_key'], lifecycle],
  },
  {
    name: 'pages',
    key: ['id'],
    owner: ['owner_id'],
    // Each computer counts its own revisions: the browser saves against them.
    local: ['revision'],
    groups: [
      ['section_id', 'parent_page_id', 'sort_key'],
      ['type', 'content', 'content_text'],
      lifecycle,
    ],
  },
  { name: 'page_versions', key: ['id'], owner: ['owner_id'] },
  { name: 'assets', key: ['id'], owner: ['owner_id'] },
  { name: 'asset_blobs', key: ['sha256'], owner: ['owner_id'], blob: 'data' },
  { name: 'tags', key: ['id'], owner: ['owner_id'], groups: [['name', 'name_key']] },
  { name: 'page_tags', key: ['page_id', 'tag_id'], owner: [] },
  { name: 'templates', key: ['id'], owner: ['owner_id'] },
  {
    name: 'user_settings',
    key: ['key'],
    owner: ['user_id'],
    // Where you were on this computer stays on it; favourites, layouts and the rest travel.
    json: {
      column: 'value_json',
      local: { ui: ['lastSectionId', 'lastPages', 'expanded', 'recent'] },
    },
  },
  { name: 'projects', key: ['id'], owner: ['owner_id'], max: ['next_card_number'] },
  { name: 'boards', key: ['id'], owner: ['owner_id'] },
  { name: 'board_columns', key: ['id'], owner: ['owner_id'] },
  { name: 'swimlanes', key: ['id'], owner: ['owner_id'] },
  {
    name: 'cards',
    key: ['id'],
    owner: ['owner_id'],
    groups: [['board_id', 'column_id', 'swimlane_id', 'sort_key', 'completed_at']],
  },
  { name: 'labels', key: ['id'], owner: ['owner_id'] },
  { name: 'card_labels', key: ['card_id', 'label_id'], owner: [] },
  { name: 'checklists', key: ['id'], owner: ['owner_id'] },
  { name: 'checklist_items', key: ['id'], owner: ['owner_id'] },
  { name: 'card_comments', key: ['id'], owner: ['owner_id'], people: ['user_id'] },
  { name: 'card_pages', key: ['card_id', 'page_id'], owner: [] },
  { name: 'card_attachments', key: ['card_id', 'asset_id'], owner: [] },
  { name: 'card_activity', key: ['id'], owner: ['owner_id'], people: ['user_id'] },
];

/** Tables that stay on their computer: accounts, logs, indexes rebuilt from the notes, sync's own. */
export const LOCAL_TABLES: readonly string[] = [
  'app_meta',
  'users',
  'sessions',
  'recovery_codes',
  'audit_log',
  // Rebuilt from the pages here.
  'page_links',
  'page_search',
  'card_search',
  'sync_state',
  'sync_dirty',
  'sync_clock',
  'sync_parked',
  'sync_alias',
  '__drizzle_migrations',
  'sqlite_sequence',
];

/** Full-text search tables (`fts_pages`, `fts_cards` and their shadow tables) stay local too. */
export const isLocalTable = (name: string): boolean =>
  LOCAL_TABLES.includes(name) || name.startsWith('fts_');

export interface Column {
  name: string;
  notNull: boolean;
  hasDefault: boolean;
}

export interface ForeignKey {
  column: string;
  table: string;
}

/** A synced table as this database has it. */
export interface Table extends TableSpec {
  /** Its position in SYNCED_TABLES: lower is applied first. */
  order: number;
  columns: Column[];
  columnNames: Set<string>;
  /** Columns that travel (key, owner, local and blob columns left out). */
  fields: string[];
  /** The group of each field. */
  groupOf: Map<string, string>;
  /** References to other synced tables, by column. */
  parents: ForeignKey[];
}

/** Reads the synced tables' columns and references from the database's schema. */
export function readTables(db: SqliteDatabase): Map<string, Table> {
  const tables = new Map<string, Table>();
  const synced = new Set(SYNCED_TABLES.map((t) => t.name));
  SYNCED_TABLES.forEach((spec, order) => {
    const info = db.prepare(`PRAGMA table_info("${spec.name}")`).all() as {
      name: string;
      notnull: number;
      dflt_value: unknown;
    }[];
    if (info.length === 0) throw new Error(`sync: table ${spec.name} doesn't exist`);
    const columns = info.map((c) => ({
      name: c.name,
      notNull: c.notnull === 1,
      hasDefault: c.dflt_value !== null,
    }));
    const columnNames = new Set(columns.map((c) => c.name));
    for (const name of [
      ...spec.key,
      ...spec.owner,
      ...(spec.people ?? []),
      ...(spec.local ?? []),
    ]) {
      if (!columnNames.has(name)) throw new Error(`sync: ${spec.name}.${name} doesn't exist`);
    }
    const left = new Set([...spec.key, ...spec.owner, ...(spec.local ?? [])]);
    if (spec.blob) left.add(spec.blob);
    const fields = columns.map((c) => c.name).filter((name) => !left.has(name));
    const groupOf = new Map<string, string>();
    for (const group of spec.groups ?? []) {
      for (const name of group) groupOf.set(name, group[0]!);
    }
    for (const name of fields) if (!groupOf.has(name)) groupOf.set(name, name);
    const parents = (
      db.prepare(`PRAGMA foreign_key_list("${spec.name}")`).all() as {
        table: string;
        from: string;
      }[]
    )
      .filter((fk) => synced.has(fk.table))
      .map((fk) => ({ column: fk.from, table: fk.table }));
    tables.set(spec.name, { ...spec, order, columns, columnNames, fields, groupOf, parents });
  });
  return tables;
}

/** A row's key as stored in sync's tables: the key columns' values as a JSON array. */
export const keyOf = (table: TableSpec, row: Record<string, unknown>): string =>
  JSON.stringify(table.key.map((column) => row[column]));
