import { assetIdsIn, keysBetween, uuidv7 } from '@memora/shared';
import { z } from 'zod';
import type { SqliteDatabase } from '../db/client';

/*
 * Kanban in `.memora` archives (§8.4, docs/FILE_FORMAT.md): one file per project (with its
 * labels) and one per board (columns, swimlanes and cards with everything they hold). Only
 * exports of everything carry them. Imports give everything new ids, like the notes, and a new
 * key to a project whose key is taken.
 */

type Row = Record<string, unknown>;

export function projectFiles(db: SqliteDatabase, owner: string) {
  const projects = db
    .prepare(
      `SELECT id, name, key, color, icon, sort_key AS sortKey, archived_at AS archivedAt,
         next_card_number AS nextCardNumber, created_at AS createdAt, updated_at AS updatedAt
       FROM projects WHERE owner_id = ? ORDER BY sort_key, id`,
    )
    .all(owner) as ({ id: string } & Row)[];
  const labels = db
    .prepare(
      'SELECT id, project_id AS projectId, name, color FROM labels WHERE owner_id = ? ORDER BY created_at, id',
    )
    .all(owner) as ({ projectId: string } & Row)[];
  return projects.map((p) => ({ ...p, labels: labels.filter((l) => l.projectId === p.id) }));
}

export function boardIds(db: SqliteDatabase, owner: string): string[] {
  return (
    db.prepare('SELECT id FROM boards WHERE owner_id = ? ORDER BY sort_key, id').all(owner) as {
      id: string;
    }[]
  ).map((b) => b.id);
}

/** A board with everything on it, read when its file is written. */
export function boardFile(db: SqliteDatabase, id: string) {
  const board = db
    .prepare(
      `SELECT id, project_id AS projectId, name, description, sort_key AS sortKey, settings_json AS settings,
         archived_at AS archivedAt, created_at AS createdAt, updated_at AS updatedAt FROM boards WHERE id = ?`,
    )
    .get(id) as Row & { settings: string };
  const columns = db
    .prepare(
      `SELECT id, name, color, wip_limit AS wipLimit, wip_strict AS wipStrict, is_done AS isDone, collapsed, sort,
         sort_key AS sortKey, archived_at AS archivedAt FROM board_columns WHERE board_id = ? ORDER BY sort_key, id`,
    )
    .all(id);
  const swimlanes = db
    .prepare(
      'SELECT id, name, color, collapsed, sort_key AS sortKey FROM swimlanes WHERE board_id = ? ORDER BY sort_key, id',
    )
    .all(id);
  const cards = (
    db
      .prepare(
        `SELECT id, column_id AS columnId, swimlane_id AS swimlaneId, number, title, description, priority,
           start_date AS startDate, due_date AS dueDate, cover_color AS coverColor, sort_key AS sortKey,
           completed_at AS completedAt, archived_at AS archivedAt, created_at AS createdAt, updated_at AS updatedAt
         FROM cards WHERE board_id = ? ORDER BY sort_key, id`,
      )
      .all(id) as ({ id: string } & Row)[]
  ).map((card) => ({
    ...card,
    labelIds: (
      db.prepare('SELECT label_id AS id FROM card_labels WHERE card_id = ?').all(card.id) as {
        id: string;
      }[]
    ).map((l) => l.id),
    checklists: (
      db
        .prepare(
          'SELECT id, title, sort_key AS sortKey FROM checklists WHERE card_id = ? ORDER BY sort_key, id',
        )
        .all(card.id) as ({
        id: string;
      } & Row)[]
    ).map(({ id: listId, ...list }) => ({
      ...list,
      items: db
        .prepare(
          'SELECT text, done, sort_key AS sortKey FROM checklist_items WHERE checklist_id = ? ORDER BY sort_key, id',
        )
        .all(listId),
    })),
    comments: db
      .prepare(
        `SELECT coalesce(u.display_name, '') AS author, m.body, m.created_at AS createdAt, m.edited_at AS editedAt
         FROM card_comments m LEFT JOIN users u ON u.id = m.user_id WHERE m.card_id = ? ORDER BY m.created_at, m.id`,
      )
      .all(card.id),
    pageIds: (
      db
        .prepare('SELECT page_id AS id FROM card_pages WHERE card_id = ? ORDER BY created_at')
        .all(card.id) as {
        id: string;
      }[]
    ).map((p) => p.id),
    attachments: (
      db
        .prepare('SELECT asset_id AS id FROM card_attachments WHERE card_id = ? ORDER BY sort_key')
        .all(card.id) as { id: string }[]
    ).map((a) => a.id),
    activity: db
      .prepare(
        'SELECT type, payload_json AS payload, created_at AS createdAt FROM card_activity WHERE card_id = ? ORDER BY created_at, id',
      )
      .all(card.id),
  }));
  return { ...board, settings: JSON.parse(board.settings) as unknown, columns, swimlanes, cards };
}

/** Files cards use: in descriptions and comments, and attached. */
export function cardAssetIds(db: SqliteDatabase, owner: string): string[] {
  const ids = new Set<string>();
  for (const sql of [
    'SELECT description AS text FROM cards WHERE owner_id = ?',
    'SELECT body AS text FROM card_comments WHERE owner_id = ?',
  ]) {
    for (const row of db.prepare(sql).iterate(owner) as Iterable<{ text: string }>) {
      if (row.text.includes('asset:')) for (const id of assetIdsIn(row.text)) ids.add(id);
    }
  }
  for (const row of db
    .prepare(
      'SELECT ca.asset_id AS id FROM card_attachments ca JOIN cards c ON c.id = ca.card_id WHERE c.owner_id = ?',
    )
    .iterate(owner) as Iterable<{ id: string }>) {
    ids.add(row.id);
  }
  return [...ids];
}

// Reading them back

const bool = z.union([z.boolean(), z.number()]).transform((v) => !!v);
const optionalText = z.string().nullable().optional();

export const projectFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  color: z.string(),
  icon: z.string().optional(),
  sortKey: z.string().optional(),
  archivedAt: z.number().nullable().optional(),
  nextCardNumber: z.number().optional(),
  labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })).default([]),
});

export const boardFileSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().default(''),
  sortKey: z.string().optional(),
  settings: z.unknown().optional(),
  archivedAt: z.number().nullable().optional(),
  columns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: optionalText,
      wipLimit: z.number().nullable().optional(),
      wipStrict: bool.optional(),
      isDone: bool.optional(),
      collapsed: bool.optional(),
      sort: z.string().optional(),
      sortKey: z.string().optional(),
      archivedAt: z.number().nullable().optional(),
    }),
  ),
  swimlanes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: optionalText,
        collapsed: bool.optional(),
        sortKey: z.string().optional(),
      }),
    )
    .default([]),
  cards: z.array(
    z.object({
      id: z.string(),
      columnId: z.string(),
      swimlaneId: optionalText,
      number: z.number(),
      title: z.string(),
      description: z.string().default(''),
      priority: z.string().default('none'),
      startDate: optionalText,
      dueDate: optionalText,
      coverColor: optionalText,
      sortKey: z.string().optional(),
      completedAt: z.number().nullable().optional(),
      archivedAt: z.number().nullable().optional(),
      createdAt: z.number().optional(),
      updatedAt: z.number().optional(),
      labelIds: z.array(z.string()).default([]),
      checklists: z
        .array(
          z.object({
            title: z.string(),
            sortKey: z.string().optional(),
            items: z
              .array(
                z.object({
                  text: z.string(),
                  done: bool.optional(),
                  sortKey: z.string().optional(),
                }),
              )
              .default([]),
          }),
        )
        .default([]),
      comments: z
        .array(
          z.object({
            body: z.string(),
            createdAt: z.number().optional(),
            editedAt: z.number().nullable().optional(),
          }),
        )
        .default([]),
      pageIds: z.array(z.string()).default([]),
      attachments: z.array(z.string()).default([]),
      activity: z
        .array(
          z.object({
            type: z.string(),
            payload: z.string().optional(),
            createdAt: z.number().optional(),
          }),
        )
        .default([]),
    }),
  ),
});

export type ProjectFile = z.infer<typeof projectFileSchema>;
export type BoardFile = z.infer<typeof boardFileSchema>;

const PRIORITIES = new Set(['none', 'low', 'medium', 'high', 'urgent']);
const SORTS = new Set(['manual', 'due', 'priority', 'created']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A key not used yet: `WEB`, else `WEB2`, `WEB3`… */
function freeKey(db: SqliteDatabase, owner: string, key: string): string {
  const clean = /^[A-Z][A-Z0-9]{1,9}$/.test(key) ? key : 'PRJ';
  const taken = new Set(
    (db.prepare('SELECT key FROM projects WHERE owner_id = ?').all(owner) as { key: string }[]).map(
      (p) => p.key,
    ),
  );
  if (!taken.has(clean)) return clean;
  for (let n = 2; ; n += 1) {
    const candidate = `${clean.slice(0, 10 - String(n).length)}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface KanbanImport {
  projects: number;
  boards: number;
  cards: number;
}

/**
 * Adds projects and boards (inside the import's transaction): new ids throughout, pages and
 * files mapped to what the import made of them.
 */
export function importKanban(
  db: SqliteDatabase,
  owner: string,
  projects: ProjectFile[],
  boards: () => Iterable<BoardFile>,
  pageIds: ReadonlyMap<string, string>,
  mapText: (text: string) => string,
  assetIds: ReadonlyMap<string, string>,
  now: number,
  colorOk: (c: string | null | undefined) => boolean,
): KanbanImport {
  const counts: KanbanImport = { projects: 0, boards: 0, cards: 0 };
  const projectIds = new Map<string, string>();
  const labelIds = new Map<string, string>();
  const last = (sql: string, ...args: unknown[]) =>
    (db.prepare(sql).get(...args) as { key: string | null } | undefined)?.key ?? null;
  let projectKey = last('SELECT max(sort_key) AS key FROM projects WHERE owner_id = ?', owner);
  const color = (c: string | null | undefined, fallback: string | null) =>
    colorOk(c) ? c! : fallback;

  for (const p of projects.sort((a, b) => ((a.sortKey ?? '') < (b.sortKey ?? '') ? -1 : 1))) {
    const id = uuidv7(now);
    [projectKey] = keysBetween(projectKey, null, 1) as [string];
    db.prepare(
      `INSERT INTO projects (id, owner_id, name, key, color, icon, sort_key, archived_at, next_card_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      owner,
      p.name.slice(0, 100) || 'Project',
      freeKey(db, owner, p.key),
      color(p.color, 'blue'),
      p.icon ?? 'square-kanban',
      projectKey,
      p.archivedAt ?? null,
      Math.max(1, p.nextCardNumber ?? 1),
      now,
      now,
    );
    projectIds.set(p.id, id);
    for (const label of p.labels) {
      const labelId = uuidv7(now);
      db.prepare(
        'INSERT INTO labels (id, owner_id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(labelId, owner, id, label.name.slice(0, 40), color(label.color, 'blue'), now);
      labelIds.set(label.id, labelId);
    }
    counts.projects += 1;
  }

  for (const board of boards()) {
    const projectId = projectIds.get(board.projectId);
    if (!projectId) continue;
    const boardId = uuidv7(now);
    db.prepare(
      `INSERT INTO boards (id, owner_id, project_id, name, description, sort_key, settings_json, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      boardId,
      owner,
      projectId,
      board.name.slice(0, 100) || 'Board',
      board.description.slice(0, 2000),
      board.sortKey ?? 'a0',
      JSON.stringify(board.settings ?? { lanes: 'none' }),
      board.archivedAt ?? null,
      now,
      now,
    );
    counts.boards += 1;
    const columnIds = new Map<string, string>();
    for (const c of board.columns) {
      const id = uuidv7(now);
      db.prepare(
        `INSERT INTO board_columns (id, owner_id, board_id, name, color, wip_limit, wip_strict, is_done, collapsed, sort,
           sort_key, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        owner,
        boardId,
        c.name.slice(0, 100) || 'Column',
        color(c.color, null),
        c.wipLimit && c.wipLimit > 0 ? Math.min(c.wipLimit, 999) : null,
        c.wipStrict ? 1 : 0,
        c.isDone ? 1 : 0,
        c.collapsed ? 1 : 0,
        SORTS.has(c.sort ?? '') ? c.sort : 'manual',
        c.sortKey ?? 'a0',
        c.archivedAt ?? null,
        now,
        now,
      );
      columnIds.set(c.id, id);
    }
    const laneIds = new Map<string, string>();
    for (const l of board.swimlanes) {
      const id = uuidv7(now);
      db.prepare(
        'INSERT INTO swimlanes (id, owner_id, board_id, name, color, collapsed, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        owner,
        boardId,
        l.name.slice(0, 100) || 'Lane',
        color(l.color, null),
        l.collapsed ? 1 : 0,
        l.sortKey ?? 'a0',
        now,
        now,
      );
      laneIds.set(l.id, id);
    }
    let highest = 0;
    for (const card of board.cards) {
      const columnId = columnIds.get(card.columnId);
      if (!columnId) continue;
      const id = uuidv7(now);
      highest = Math.max(highest, card.number);
      db.prepare(
        `INSERT INTO cards (id, owner_id, board_id, column_id, swimlane_id, number, title, description, priority, start_date,
           due_date, cover_color, sort_key, completed_at, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        owner,
        boardId,
        columnId,
        card.swimlaneId ? (laneIds.get(card.swimlaneId) ?? null) : null,
        card.number,
        card.title.slice(0, 300) || 'Card',
        mapText(card.description),
        PRIORITIES.has(card.priority) ? card.priority : 'none',
        card.startDate && DATE.test(card.startDate) ? card.startDate : null,
        card.dueDate && DATE.test(card.dueDate) ? card.dueDate : null,
        color(card.coverColor, null),
        card.sortKey ?? 'a0',
        card.completedAt ?? null,
        card.archivedAt ?? null,
        card.createdAt ?? now,
        card.updatedAt ?? now,
      );
      counts.cards += 1;
      for (const label of card.labelIds) {
        const labelId = labelIds.get(label);
        if (labelId)
          db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)').run(
            id,
            labelId,
          );
      }
      for (const list of card.checklists) {
        const listId = uuidv7(now);
        db.prepare(
          'INSERT INTO checklists (id, owner_id, card_id, title, sort_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(
          listId,
          owner,
          id,
          list.title.slice(0, 200) || 'Checklist',
          list.sortKey ?? 'a0',
          now,
        );
        for (const item of list.items) {
          db.prepare(
            'INSERT INTO checklist_items (id, owner_id, checklist_id, text, done, sort_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          ).run(
            uuidv7(now),
            owner,
            listId,
            item.text.slice(0, 500) || '…',
            item.done ? 1 : 0,
            item.sortKey ?? 'a0',
            now,
          );
        }
      }
      for (const comment of card.comments) {
        db.prepare(
          'INSERT INTO card_comments (id, owner_id, card_id, user_id, body, created_at, edited_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          uuidv7(now),
          owner,
          id,
          owner,
          mapText(comment.body),
          comment.createdAt ?? now,
          comment.editedAt ?? null,
        );
      }
      for (const page of card.pageIds) {
        const pageId = pageIds.get(page);
        if (pageId)
          db.prepare(
            'INSERT OR IGNORE INTO card_pages (card_id, page_id, created_at) VALUES (?, ?, ?)',
          ).run(id, pageId, now);
      }
      card.attachments.forEach((asset, i) => {
        const assetId = assetIds.get(asset.toLowerCase());
        if (assetId) {
          db.prepare(
            'INSERT OR IGNORE INTO card_attachments (card_id, asset_id, sort_key, created_at) VALUES (?, ?, ?, ?)',
          ).run(id, assetId, `a${String(i).padStart(4, '0')}`, now);
        }
      });
      for (const entry of card.activity) {
        db.prepare(
          'INSERT INTO card_activity (id, owner_id, card_id, user_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(
          uuidv7(now),
          owner,
          id,
          owner,
          entry.type,
          entry.payload ?? '{}',
          entry.createdAt ?? now,
        );
      }
    }
    db.prepare('UPDATE projects SET next_card_number = max(next_card_number, ?) WHERE id = ?').run(
      highest + 1,
      projectId,
    );
  }
  return counts;
}
