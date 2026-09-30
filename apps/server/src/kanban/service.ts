import {
  BOARD_TEMPLATE_COLUMNS,
  keysBetween,
  uuidv7,
  type ActivityType,
  type Board,
  type BoardData,
  type BoardSettings,
  type BoardTemplate,
  type Card,
  type CardActivity,
  type CardAttachment,
  type CardComment,
  type CardDetail,
  type CardPage,
  type Checklist,
  type ChecklistItem,
  type ColorId,
  type Column,
  type ColumnSort,
  type CreateCardRequest,
  type Label,
  type LinkedCard,
  type Priority,
  type Project,
  type ProjectIcon,
  type Projects,
  type Swimlane,
} from '@memora/shared';
import type { SqliteDatabase } from '../db/client';
import { ApiError, notFound } from '../errors';

/*
 * Kanban (§9.11). Everything is scoped to its owner, like the notes: another user's ids are
 * simply not found. Sort keys order siblings (projects, boards, columns, lanes, cards in a
 * column, checklist items); a card's place in a column doesn't depend on its lane, so lanes
 * show a column's cards in the same order.
 */

interface ProjectRow {
  id: string;
  name: string;
  key: string;
  color: string;
  icon: string;
  sort_key: string;
  archived_at: number | null;
  next_card_number: number;
  created_at: number;
  updated_at: number;
}

interface BoardRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  sort_key: string;
  settings_json: string;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ColumnRow {
  id: string;
  board_id: string;
  name: string;
  color: string | null;
  wip_limit: number | null;
  wip_strict: number;
  is_done: number;
  collapsed: number;
  sort: string;
  sort_key: string;
  archived_at: number | null;
}

interface CardRow {
  id: string;
  board_id: string;
  column_id: string;
  swimlane_id: string | null;
  number: number;
  title: string;
  description: string;
  priority: string;
  start_date: string | null;
  due_date: string | null;
  cover_color: string | null;
  sort_key: string;
  completed_at: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
}

interface FaceRow extends CardRow {
  items: number;
  items_done: number;
  comments: number;
  attachments: number;
  pages: number;
}

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  key: r.key,
  color: r.color as ColorId,
  icon: r.icon as ProjectIcon,
  sortKey: r.sort_key,
  archivedAt: r.archived_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function settingsOf(json: string): BoardSettings {
  try {
    const parsed = JSON.parse(json) as Partial<BoardSettings>;
    return { lanes: parsed.lanes ?? 'none', ...(parsed.hide ? { hide: parsed.hide } : {}) };
  } catch {
    return { lanes: 'none' };
  }
}

const toBoard = (r: BoardRow): Board => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  sortKey: r.sort_key,
  settings: settingsOf(r.settings_json),
  archivedAt: r.archived_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toColumn = (r: ColumnRow): Column => ({
  id: r.id,
  boardId: r.board_id,
  name: r.name,
  color: r.color as ColorId | null,
  wipLimit: r.wip_limit,
  wipStrict: !!r.wip_strict,
  isDone: !!r.is_done,
  collapsed: !!r.collapsed,
  sort: r.sort as ColumnSort,
  sortKey: r.sort_key,
  archivedAt: r.archived_at,
});

const FACE = `SELECT c.*,
  (SELECT count(*) FROM checklist_items i JOIN checklists l ON l.id = i.checklist_id WHERE l.card_id = c.id) AS items,
  (SELECT count(*) FROM checklist_items i JOIN checklists l ON l.id = i.checklist_id WHERE l.card_id = c.id AND i.done = 1) AS items_done,
  (SELECT count(*) FROM card_comments m WHERE m.card_id = c.id) AS comments,
  (SELECT count(*) FROM card_attachments a WHERE a.card_id = c.id) AS attachments,
  (SELECT count(*) FROM card_pages cp JOIN pages p ON p.id = cp.page_id WHERE cp.card_id = c.id AND p.deleted_at IS NULL) AS pages
  FROM cards c`;

const toCard = (r: FaceRow, labels: string[]): Card => ({
  id: r.id,
  boardId: r.board_id,
  columnId: r.column_id,
  swimlaneId: r.swimlane_id,
  number: r.number,
  title: r.title,
  priority: r.priority as Priority,
  startDate: r.start_date,
  dueDate: r.due_date,
  coverColor: r.cover_color as ColorId | null,
  labelIds: labels,
  checklist: { done: r.items_done, total: r.items },
  comments: r.comments,
  attachments: r.attachments,
  pages: r.pages,
  sortKey: r.sort_key,
  completedAt: r.completed_at,
  archivedAt: r.archived_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export interface Actor {
  owner: string;
  userId: string;
}

export class KanbanService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => number,
  ) {}

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /** Where an item goes among its siblings: before `beforeId`, or last. */
  private place(
    siblings: { id: string; sort_key: string }[],
    beforeId: string | null,
    self?: string,
  ): string {
    const list = siblings
      .filter((s) => s.id !== self)
      .sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1));
    const index = beforeId ? list.findIndex((s) => s.id === beforeId) : -1;
    if (beforeId && index < 0)
      throw new ApiError(422, 'invalid_move', 'That place no longer exists.');
    const before =
      index < 0 ? (list.at(-1)?.sort_key ?? null) : (list[index - 1]?.sort_key ?? null);
    const after = index < 0 ? null : list[index]!.sort_key;
    return keysBetween(before, after, 1)[0]!;
  }

  // Reading rows the owner has

  private projectRow(owner: string, id: string): ProjectRow {
    const row = this.db
      .prepare('SELECT * FROM projects WHERE id = ? AND owner_id = ?')
      .get(id, owner) as ProjectRow | undefined;
    if (!row) throw notFound('Project not found.');
    return row;
  }

  private boardRow(owner: string, id: string): BoardRow {
    const row = this.db
      .prepare('SELECT * FROM boards WHERE id = ? AND owner_id = ?')
      .get(id, owner) as BoardRow | undefined;
    if (!row) throw notFound('Board not found.');
    return row;
  }

  private columnRow(owner: string, id: string): ColumnRow {
    const row = this.db
      .prepare('SELECT * FROM board_columns WHERE id = ? AND owner_id = ?')
      .get(id, owner) as ColumnRow | undefined;
    if (!row) throw notFound('Column not found.');
    return row;
  }

  private cardRow(owner: string, id: string): CardRow {
    const row = this.db
      .prepare('SELECT * FROM cards WHERE id = ? AND owner_id = ?')
      .get(id, owner) as CardRow | undefined;
    if (!row) throw notFound('Card not found.');
    return row;
  }

  private laneOf(owner: string, boardId: string, laneId: string | null): string | null {
    if (!laneId) return null;
    const row = this.db
      .prepare('SELECT id FROM swimlanes WHERE id = ? AND owner_id = ? AND board_id = ?')
      .get(laneId, owner, boardId);
    if (!row) throw notFound('Swimlane not found.');
    return laneId;
  }

  private projectOfBoard(boardId: string): ProjectRow {
    return this.db
      .prepare('SELECT p.* FROM projects p JOIN boards b ON b.project_id = p.id WHERE b.id = ?')
      .get(boardId) as ProjectRow;
  }

  private log(
    actor: Actor,
    cardId: string,
    type: ActivityType,
    payload: Record<string, unknown> = {},
  ) {
    this.db
      .prepare(
        `INSERT INTO card_activity (id, owner_id, card_id, user_id, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        uuidv7(this.now()),
        actor.owner,
        cardId,
        actor.userId,
        type,
        JSON.stringify(payload),
        this.now(),
      );
  }

  private touchCard(id: string) {
    this.db.prepare('UPDATE cards SET updated_at = ? WHERE id = ?').run(this.now(), id);
  }

  // Projects and boards

  projects(owner: string): Projects {
    const projects = (
      this.db
        .prepare('SELECT * FROM projects WHERE owner_id = ? ORDER BY sort_key, id')
        .all(owner) as ProjectRow[]
    ).map(toProject);
    const boards = (
      this.db
        .prepare('SELECT * FROM boards WHERE owner_id = ? ORDER BY sort_key, id')
        .all(owner) as BoardRow[]
    ).map(toBoard);
    const labels = (
      this.db
        .prepare(
          'SELECT id, project_id, name, color FROM labels WHERE owner_id = ? ORDER BY created_at, id',
        )
        .all(owner) as { id: string; project_id: string; name: string; color: string }[]
    ).map((l): Label => ({
      id: l.id,
      projectId: l.project_id,
      name: l.name,
      color: l.color as ColorId,
    }));
    return { projects, boards, labels };
  }

  private keyFree(owner: string, key: string, except?: string) {
    const taken = this.db
      .prepare('SELECT id FROM projects WHERE owner_id = ? AND key = ? AND id IS NOT ?')
      .get(owner, key, except ?? null);
    if (taken) throw new ApiError(409, 'key_taken', `Another project already uses the key ${key}.`);
  }

  createProject(
    owner: string,
    body: { name: string; key: string; color: ColorId; icon: ProjectIcon; template: BoardTemplate },
  ): { project: Project; board: Board } {
    return this.tx(() => {
      this.keyFree(owner, body.key);
      const now = this.now();
      const id = uuidv7(now);
      const siblings = this.db
        .prepare('SELECT id, sort_key FROM projects WHERE owner_id = ?')
        .all(owner) as { id: string; sort_key: string }[];
      this.db
        .prepare(
          `INSERT INTO projects (id, owner_id, name, key, color, icon, sort_key, next_card_number, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          owner,
          body.name,
          body.key,
          body.color,
          body.icon,
          this.place(siblings, null),
          now,
          now,
        );
      const board = this.createBoard(owner, {
        projectId: id,
        name: 'Board',
        template: body.template,
      });
      return { project: toProject(this.projectRow(owner, id)), board };
    });
  }

  updateProject(
    owner: string,
    id: string,
    patch: {
      name?: string;
      key?: string;
      color?: ColorId;
      icon?: ProjectIcon;
      archived?: boolean;
      beforeId?: string | null;
    },
  ): Project {
    return this.tx(() => {
      const row = this.projectRow(owner, id);
      if (patch.key !== undefined && patch.key !== row.key) this.keyFree(owner, patch.key, id);
      let sortKey = row.sort_key;
      if (patch.beforeId !== undefined) {
        const siblings = this.db
          .prepare('SELECT id, sort_key FROM projects WHERE owner_id = ?')
          .all(owner) as { id: string; sort_key: string }[];
        sortKey = this.place(siblings, patch.beforeId, id);
      }
      this.db
        .prepare(
          `UPDATE projects SET name = ?, key = ?, color = ?, icon = ?, sort_key = ?, archived_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          patch.name ?? row.name,
          patch.key ?? row.key,
          patch.color ?? row.color,
          patch.icon ?? row.icon,
          sortKey,
          patch.archived === undefined ? row.archived_at : patch.archived ? this.now() : null,
          this.now(),
          id,
        );
      return toProject(this.projectRow(owner, id));
    });
  }

  deleteProject(owner: string, id: string): void {
    this.projectRow(owner, id);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  createBoard(
    owner: string,
    body: { projectId: string; name: string; template: BoardTemplate },
  ): Board {
    return this.tx(() => {
      this.projectRow(owner, body.projectId);
      const now = this.now();
      const id = uuidv7(now);
      const siblings = this.db
        .prepare('SELECT id, sort_key FROM boards WHERE project_id = ?')
        .all(body.projectId) as { id: string; sort_key: string }[];
      this.db
        .prepare(
          `INSERT INTO boards (id, owner_id, project_id, name, description, sort_key, settings_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, '', ?, '{"lanes":"none"}', ?, ?)`,
        )
        .run(id, owner, body.projectId, body.name, this.place(siblings, null), now, now);
      const names = BOARD_TEMPLATE_COLUMNS[body.template];
      const keys = keysBetween(null, null, names.length);
      names.forEach((name, i) => {
        this.db
          .prepare(
            `INSERT INTO board_columns (id, owner_id, board_id, name, is_done, sort_key, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(uuidv7(now), owner, id, name, i === names.length - 1 ? 1 : 0, keys[i], now, now);
      });
      return toBoard(this.boardRow(owner, id));
    });
  }

  updateBoard(
    owner: string,
    id: string,
    patch: {
      name?: string;
      description?: string;
      lanes?: BoardSettings['lanes'];
      archived?: boolean;
      beforeId?: string | null;
    },
  ): Board {
    return this.tx(() => {
      const row = this.boardRow(owner, id);
      let sortKey = row.sort_key;
      if (patch.beforeId !== undefined) {
        const siblings = this.db
          .prepare('SELECT id, sort_key FROM boards WHERE project_id = ?')
          .all(row.project_id) as { id: string; sort_key: string }[];
        sortKey = this.place(siblings, patch.beforeId, id);
      }
      const settings = settingsOf(row.settings_json);
      if (patch.lanes) settings.lanes = patch.lanes;
      this.db
        .prepare(
          `UPDATE boards SET name = ?, description = ?, sort_key = ?, settings_json = ?, archived_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          patch.name ?? row.name,
          patch.description ?? row.description,
          sortKey,
          JSON.stringify(settings),
          patch.archived === undefined ? row.archived_at : patch.archived ? this.now() : null,
          this.now(),
          id,
        );
      return toBoard(this.boardRow(owner, id));
    });
  }

  deleteBoard(owner: string, id: string): void {
    this.boardRow(owner, id);
    this.db.prepare('DELETE FROM boards WHERE id = ?').run(id);
  }

  /** Everything a board shows; with `archived`, its archived columns and cards instead. */
  board(owner: string, id: string, archived = false): BoardData {
    const row = this.boardRow(owner, id);
    const project = this.projectOfBoard(id);
    const columns = (
      this.db
        .prepare('SELECT * FROM board_columns WHERE board_id = ? ORDER BY sort_key, id')
        .all(id) as ColumnRow[]
    ).map(toColumn);
    const swimlanes = (
      this.db
        .prepare('SELECT * FROM swimlanes WHERE board_id = ? ORDER BY sort_key, id')
        .all(id) as {
        id: string;
        board_id: string;
        name: string;
        color: string | null;
        collapsed: number;
        sort_key: string;
      }[]
    ).map((l): Swimlane => ({
      id: l.id,
      boardId: l.board_id,
      name: l.name,
      color: l.color as ColorId | null,
      collapsed: !!l.collapsed,
      sortKey: l.sort_key,
    }));
    const labelsOf = new Map<string, string[]>();
    for (const r of this.db
      .prepare(
        `SELECT cl.card_id, cl.label_id FROM card_labels cl JOIN cards c ON c.id = cl.card_id
         JOIN labels l ON l.id = cl.label_id WHERE c.board_id = ? ORDER BY l.created_at, l.id`,
      )
      .all(id) as { card_id: string; label_id: string }[]) {
      labelsOf.set(r.card_id, [...(labelsOf.get(r.card_id) ?? []), r.label_id]);
    }
    const cards = (
      this.db
        .prepare(
          `${FACE} WHERE c.board_id = ? AND c.archived_at IS ${archived ? 'NOT NULL' : 'NULL'} ORDER BY c.sort_key, c.id`,
        )
        .all(id) as FaceRow[]
    ).map((r) => toCard(r, labelsOf.get(r.id) ?? []));
    return {
      board: toBoard(row),
      project: toProject(project),
      labels: this.projects(owner).labels.filter((l) => l.projectId === project.id),
      columns,
      swimlanes,
      cards,
    };
  }

  // Columns and lanes

  createColumn(
    owner: string,
    boardId: string,
    body: { name: string; beforeId: string | null },
  ): Column {
    return this.tx(() => {
      this.boardRow(owner, boardId);
      const now = this.now();
      const id = uuidv7(now);
      const siblings = this.db
        .prepare('SELECT id, sort_key FROM board_columns WHERE board_id = ?')
        .all(boardId) as { id: string; sort_key: string }[];
      this.db
        .prepare(
          `INSERT INTO board_columns (id, owner_id, board_id, name, sort_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, owner, boardId, body.name, this.place(siblings, body.beforeId), now, now);
      return toColumn(this.columnRow(owner, id));
    });
  }

  updateColumn(
    owner: string,
    id: string,
    patch: Partial<{
      name: string;
      color: ColorId | null;
      wipLimit: number | null;
      wipStrict: boolean;
      isDone: boolean;
      collapsed: boolean;
      sort: ColumnSort;
      archived: boolean;
      beforeId: string | null;
    }>,
  ): Column {
    return this.tx(() => {
      const row = this.columnRow(owner, id);
      let sortKey = row.sort_key;
      if (patch.beforeId !== undefined) {
        const siblings = this.db
          .prepare('SELECT id, sort_key FROM board_columns WHERE board_id = ?')
          .all(row.board_id) as { id: string; sort_key: string }[];
        sortKey = this.place(siblings, patch.beforeId, id);
      }
      const isDone = patch.isDone ?? !!row.is_done;
      this.db
        .prepare(
          `UPDATE board_columns SET name = ?, color = ?, wip_limit = ?, wip_strict = ?, is_done = ?, collapsed = ?,
             sort = ?, sort_key = ?, archived_at = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          patch.name ?? row.name,
          patch.color === undefined ? row.color : patch.color,
          patch.wipLimit === undefined ? row.wip_limit : patch.wipLimit,
          (patch.wipStrict ?? !!row.wip_strict) ? 1 : 0,
          isDone ? 1 : 0,
          (patch.collapsed ?? !!row.collapsed) ? 1 : 0,
          patch.sort ?? row.sort,
          sortKey,
          patch.archived === undefined ? row.archived_at : patch.archived ? this.now() : null,
          this.now(),
          id,
        );
      // A column that becomes a Done column completes its cards, and the other way round.
      if (patch.isDone !== undefined && patch.isDone !== !!row.is_done) {
        this.db
          .prepare(
            `UPDATE cards SET completed_at = ${patch.isDone ? '?' : 'NULL'}, updated_at = ?
             WHERE column_id = ? ${patch.isDone ? 'AND completed_at IS NULL' : ''}`,
          )
          .run(...(patch.isDone ? [this.now(), this.now(), id] : [this.now(), id]));
      }
      return toColumn(this.columnRow(owner, id));
    });
  }

  deleteColumn(owner: string, id: string): { boardId: string } {
    const row = this.columnRow(owner, id);
    this.db.prepare('DELETE FROM board_columns WHERE id = ?').run(id);
    return { boardId: row.board_id };
  }

  createLane(
    owner: string,
    boardId: string,
    body: { name: string; beforeId: string | null },
  ): Swimlane {
    return this.tx(() => {
      this.boardRow(owner, boardId);
      const now = this.now();
      const id = uuidv7(now);
      const siblings = this.db
        .prepare('SELECT id, sort_key FROM swimlanes WHERE board_id = ?')
        .all(boardId) as { id: string; sort_key: string }[];
      const sortKey = this.place(siblings, body.beforeId);
      this.db
        .prepare(
          `INSERT INTO swimlanes (id, owner_id, board_id, name, sort_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, owner, boardId, body.name, sortKey, now, now);
      return this.board(owner, boardId).swimlanes.find((l) => l.id === id)!;
    });
  }

  private laneRow(owner: string, id: string) {
    const row = this.db
      .prepare('SELECT * FROM swimlanes WHERE id = ? AND owner_id = ?')
      .get(id, owner) as
      | {
          id: string;
          board_id: string;
          name: string;
          color: string | null;
          collapsed: number;
          sort_key: string;
        }
      | undefined;
    if (!row) throw notFound('Swimlane not found.');
    return row;
  }

  updateLane(
    owner: string,
    id: string,
    patch: Partial<{
      name: string;
      color: ColorId | null;
      collapsed: boolean;
      beforeId: string | null;
    }>,
  ): { boardId: string } {
    return this.tx(() => {
      const row = this.laneRow(owner, id);
      let sortKey = row.sort_key;
      if (patch.beforeId !== undefined) {
        const siblings = this.db
          .prepare('SELECT id, sort_key FROM swimlanes WHERE board_id = ?')
          .all(row.board_id) as { id: string; sort_key: string }[];
        sortKey = this.place(siblings, patch.beforeId, id);
      }
      this.db
        .prepare(
          'UPDATE swimlanes SET name = ?, color = ?, collapsed = ?, sort_key = ?, updated_at = ? WHERE id = ?',
        )
        .run(
          patch.name ?? row.name,
          patch.color === undefined ? row.color : patch.color,
          (patch.collapsed ?? !!row.collapsed) ? 1 : 0,
          sortKey,
          this.now(),
          id,
        );
      return { boardId: row.board_id };
    });
  }

  deleteLane(owner: string, id: string): { boardId: string } {
    const row = this.laneRow(owner, id);
    this.db.prepare('DELETE FROM swimlanes WHERE id = ?').run(id);
    return { boardId: row.board_id };
  }

  // Cards

  private face(id: string): Card {
    const row = this.db.prepare(`${FACE} WHERE c.id = ?`).get(id) as FaceRow;
    const labels = (
      this.db
        .prepare(
          'SELECT cl.label_id FROM card_labels cl JOIN labels l ON l.id = cl.label_id WHERE cl.card_id = ? ORDER BY l.created_at, l.id',
        )
        .all(id) as { label_id: string }[]
    ).map((r) => r.label_id);
    return toCard(row, labels);
  }

  /** Refuses a card for a strict column that is full. */
  private checkWip(column: ColumnRow, except?: string) {
    if (!column.wip_limit || !column.wip_strict) return;
    const { n } = this.db
      .prepare(
        'SELECT count(*) AS n FROM cards WHERE column_id = ? AND archived_at IS NULL AND id IS NOT ?',
      )
      .get(column.id, except ?? null) as { n: number };
    if (n >= column.wip_limit) {
      throw new ApiError(
        409,
        'wip_limit',
        `“${column.name}” is full: its limit is ${column.wip_limit} ${column.wip_limit === 1 ? 'card' : 'cards'}.`,
      );
    }
  }

  private cardKeyIn(column: string, beforeId: string | null, top: boolean, self?: string): string {
    const siblings = this.db
      .prepare('SELECT id, sort_key FROM cards WHERE column_id = ? AND archived_at IS NULL')
      .all(column) as { id: string; sort_key: string }[];
    if (top) {
      const first = siblings
        .filter((s) => s.id !== self)
        .sort((a, b) => (a.sort_key < b.sort_key ? -1 : 1))[0];
      return first ? this.place(siblings, first.id, self) : this.place(siblings, null, self);
    }
    return this.place(siblings, beforeId, self);
  }

  private nextNumber(projectId: string): number {
    const { next_card_number: n } = this.db
      .prepare('SELECT next_card_number FROM projects WHERE id = ?')
      .get(projectId) as { next_card_number: number };
    this.db.prepare('UPDATE projects SET next_card_number = ? WHERE id = ?').run(n + 1, projectId);
    return n;
  }

  createCard(
    actor: Actor,
    body: Omit<CreateCardRequest, 'top' | 'swimlaneId' | 'beforeId'> & {
      top: boolean;
      swimlaneId: string | null;
      beforeId: string | null;
    },
  ): Card {
    return this.tx(() => {
      const column = this.columnRow(actor.owner, body.columnId);
      if (body.id && this.db.prepare('SELECT 1 FROM cards WHERE id = ?').get(body.id)) {
        // Sent again after a lost answer: the card is there already.
        return this.face(this.cardRow(actor.owner, body.id).id);
      }
      this.checkWip(column);
      const lane = this.laneOf(actor.owner, column.board_id, body.swimlaneId);
      const project = this.projectOfBoard(column.board_id);
      const now = this.now();
      const id = body.id ?? uuidv7(now);
      this.db
        .prepare(
          `INSERT INTO cards (id, owner_id, board_id, column_id, swimlane_id, number, title, sort_key, completed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          actor.owner,
          column.board_id,
          column.id,
          lane,
          this.nextNumber(project.id),
          body.title,
          this.cardKeyIn(column.id, body.beforeId, body.top),
          column.is_done ? now : null,
          now,
          now,
        );
      this.log(actor, id, 'created', { column: column.name });
      if (body.pageId) this.linkPage(actor, id, body.pageId);
      return this.face(id);
    });
  }

  updateCard(
    actor: Actor,
    id: string,
    patch: Partial<{
      title: string;
      description: string;
      priority: Priority;
      startDate: string | null;
      dueDate: string | null;
      coverColor: ColorId | null;
      labelIds: string[];
      completed: boolean;
      archived: boolean;
    }>,
  ): Card {
    return this.tx(() => {
      const row = this.cardRow(actor.owner, id);
      const now = this.now();
      if (patch.title !== undefined && patch.title !== row.title) {
        this.log(actor, id, 'renamed', { from: row.title, to: patch.title });
      }
      if (patch.description !== undefined && patch.description !== row.description) {
        this.log(actor, id, 'described');
      }
      if (patch.priority !== undefined && patch.priority !== row.priority) {
        this.log(actor, id, 'priority_changed', { from: row.priority, to: patch.priority });
      }
      if (
        (patch.startDate !== undefined && patch.startDate !== row.start_date) ||
        (patch.dueDate !== undefined && patch.dueDate !== row.due_date)
      ) {
        this.log(actor, id, 'dates_changed', {
          start: patch.startDate === undefined ? row.start_date : patch.startDate,
          due: patch.dueDate === undefined ? row.due_date : patch.dueDate,
        });
      }
      let completedAt = row.completed_at;
      if (patch.completed !== undefined && patch.completed !== !!row.completed_at) {
        completedAt = patch.completed ? now : null;
        this.log(actor, id, patch.completed ? 'completed' : 'reopened');
      }
      let archivedAt = row.archived_at;
      if (patch.archived !== undefined && patch.archived !== !!row.archived_at) {
        archivedAt = patch.archived ? now : null;
        this.log(actor, id, patch.archived ? 'archived' : 'restored');
      }
      if (patch.labelIds) {
        const project = this.projectOfBoard(row.board_id);
        const known = new Set(
          (
            this.db.prepare('SELECT id FROM labels WHERE project_id = ?').all(project.id) as {
              id: string;
            }[]
          ).map((l) => l.id),
        );
        const wanted = [...new Set(patch.labelIds)];
        if (wanted.some((l) => !known.has(l))) throw notFound('Label not found.');
        this.db.prepare('DELETE FROM card_labels WHERE card_id = ?').run(id);
        const add = this.db.prepare('INSERT INTO card_labels (card_id, label_id) VALUES (?, ?)');
        for (const label of wanted) add.run(id, label);
        this.log(actor, id, 'labels_changed', { count: wanted.length });
      }
      // A restored card goes back to the end of its column.
      const sortKey =
        patch.archived === false && row.archived_at
          ? this.cardKeyIn(row.column_id, null, false, id)
          : row.sort_key;
      this.db
        .prepare(
          `UPDATE cards SET title = ?, description = ?, priority = ?, start_date = ?, due_date = ?, cover_color = ?,
             completed_at = ?, archived_at = ?, sort_key = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          patch.title ?? row.title,
          patch.description ?? row.description,
          patch.priority ?? row.priority,
          patch.startDate === undefined ? row.start_date : patch.startDate,
          patch.dueDate === undefined ? row.due_date : patch.dueDate,
          patch.coverColor === undefined ? row.cover_color : patch.coverColor,
          completedAt,
          archivedAt,
          sortKey,
          now,
          id,
        );
      return this.face(id);
    });
  }

  /**
   * Moves a card into a column, of this board or another one; to another project it takes a
   * new number (its key follows the project) and leaves its labels behind.
   */
  moveCard(
    actor: Actor,
    id: string,
    to: { columnId: string; swimlaneId: string | null; beforeId: string | null },
  ): { card: Card; fromBoardId: string } {
    return this.tx(() => {
      const row = this.cardRow(actor.owner, id);
      const column = this.columnRow(actor.owner, to.columnId);
      const from = this.columnRow(actor.owner, row.column_id);
      if (column.id !== row.column_id) this.checkWip(column, id);
      const lane = this.laneOf(actor.owner, column.board_id, to.swimlaneId);
      const sortKey = this.cardKeyIn(column.id, to.beforeId, false, id);
      let number = row.number;
      if (column.board_id !== row.board_id) {
        const source = this.projectOfBoard(row.board_id);
        const target = this.projectOfBoard(column.board_id);
        if (source.id !== target.id) {
          number = this.nextNumber(target.id);
          this.db.prepare('DELETE FROM card_labels WHERE card_id = ?').run(id);
        }
      }
      let completedAt = row.completed_at;
      if (column.is_done && !from.is_done) completedAt ??= this.now();
      if (!column.is_done && from.is_done) completedAt = null;
      this.db
        .prepare(
          `UPDATE cards SET board_id = ?, column_id = ?, swimlane_id = ?, number = ?, sort_key = ?, completed_at = ?,
             updated_at = ? WHERE id = ?`,
        )
        .run(column.board_id, column.id, lane, number, sortKey, completedAt, this.now(), id);
      if (column.id !== from.id) this.log(actor, id, 'moved', { from: from.name, to: column.name });
      return { card: this.face(id), fromBoardId: row.board_id };
    });
  }

  duplicateCard(actor: Actor, id: string): Card {
    return this.tx(() => {
      const row = this.cardRow(actor.owner, id);
      const column = this.columnRow(actor.owner, row.column_id);
      this.checkWip(column);
      const now = this.now();
      const copy = uuidv7(now);
      const next = this.db
        .prepare(
          'SELECT id, sort_key FROM cards WHERE column_id = ? AND archived_at IS NULL ORDER BY sort_key, id',
        )
        .all(row.column_id) as { id: string; sort_key: string }[];
      const after = next[next.findIndex((c) => c.id === id) + 1];
      this.db
        .prepare(
          `INSERT INTO cards (id, owner_id, board_id, column_id, swimlane_id, number, title, description, priority,
             start_date, due_date, cover_color, sort_key, completed_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          copy,
          actor.owner,
          row.board_id,
          row.column_id,
          row.swimlane_id,
          this.nextNumber(this.projectOfBoard(row.board_id).id),
          `${row.title} (copy)`.slice(0, 300),
          row.description,
          row.priority,
          row.start_date,
          row.due_date,
          row.cover_color,
          keysBetween(row.sort_key, after?.sort_key ?? null, 1)[0]!,
          row.completed_at,
          now,
          now,
        );
      this.db
        .prepare(
          'INSERT INTO card_labels (card_id, label_id) SELECT ?, label_id FROM card_labels WHERE card_id = ?',
        )
        .run(copy, id);
      this.db
        .prepare(
          'INSERT INTO card_pages (card_id, page_id, created_at) SELECT ?, page_id, ? FROM card_pages WHERE card_id = ?',
        )
        .run(copy, now, id);
      for (const list of this.db.prepare('SELECT * FROM checklists WHERE card_id = ?').all(id) as {
        id: string;
        title: string;
        sort_key: string;
      }[]) {
        const listId = uuidv7(now);
        this.db
          .prepare(
            'INSERT INTO checklists (id, owner_id, card_id, title, sort_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(listId, actor.owner, copy, list.title, list.sort_key, now);
        const add = this.db.prepare(
          `INSERT INTO checklist_items (id, owner_id, checklist_id, text, done, sort_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const item of this.db
          .prepare('SELECT text, done, sort_key FROM checklist_items WHERE checklist_id = ?')
          .all(list.id) as { text: string; done: number; sort_key: string }[]) {
          add.run(uuidv7(now), actor.owner, listId, item.text, item.done, item.sort_key, now);
        }
      }
      this.log(actor, copy, 'duplicated', { from: row.number });
      return this.face(copy);
    });
  }

  deleteCard(owner: string, id: string): { boardId: string } {
    const row = this.cardRow(owner, id);
    this.db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    return { boardId: row.board_id };
  }

  /** Where a card is, for events. */
  boardOfCard(owner: string, id: string): string {
    return this.cardRow(owner, id).board_id;
  }

  card(owner: string, id: string): CardDetail {
    const row = this.cardRow(owner, id);
    const project = this.projectOfBoard(row.board_id);
    const lists = this.db
      .prepare(
        'SELECT id, card_id, title, sort_key FROM checklists WHERE card_id = ? ORDER BY sort_key, id',
      )
      .all(id) as { id: string; card_id: string; title: string; sort_key: string }[];
    const items = this.db
      .prepare(
        `SELECT i.id, i.checklist_id, i.text, i.done, i.sort_key FROM checklist_items i
         JOIN checklists l ON l.id = i.checklist_id WHERE l.card_id = ? ORDER BY i.sort_key, i.id`,
      )
      .all(id) as {
      id: string;
      checklist_id: string;
      text: string;
      done: number;
      sort_key: string;
    }[];
    const checklists: Checklist[] = lists.map((l) => ({
      id: l.id,
      cardId: l.card_id,
      title: l.title,
      sortKey: l.sort_key,
      items: items
        .filter((i) => i.checklist_id === l.id)
        .map((i): ChecklistItem => ({
          id: i.id,
          checklistId: i.checklist_id,
          text: i.text,
          done: !!i.done,
          sortKey: i.sort_key,
        })),
    }));
    const comments = (
      this.db
        .prepare(
          `SELECT m.id, m.card_id, m.user_id, coalesce(u.display_name, 'Someone') AS author, m.body, m.created_at, m.edited_at
           FROM card_comments m LEFT JOIN users u ON u.id = m.user_id WHERE m.card_id = ? ORDER BY m.created_at, m.id`,
        )
        .all(id) as {
        id: string;
        card_id: string;
        user_id: string | null;
        author: string;
        body: string;
        created_at: number;
        edited_at: number | null;
      }[]
    ).map((m): CardComment => ({
      id: m.id,
      cardId: m.card_id,
      userId: m.user_id,
      author: m.author,
      body: m.body,
      createdAt: m.created_at,
      editedAt: m.edited_at,
    }));
    const attachments = (
      this.db
        .prepare(
          `SELECT a.id, a.original_name AS name, a.mime, a.size, ca.created_at FROM card_attachments ca
           JOIN assets a ON a.id = ca.asset_id WHERE ca.card_id = ? ORDER BY ca.sort_key`,
        )
        .all(id) as { id: string; name: string; mime: string; size: number; created_at: number }[]
    ).map((a): CardAttachment => ({
      assetId: a.id,
      name: a.name,
      mime: a.mime,
      size: a.size,
      createdAt: a.created_at,
    }));
    const pages = (
      this.db
        .prepare(
          `SELECT p.id, p.title, p.section_id, p.type, p.deleted_at FROM card_pages cp JOIN pages p ON p.id = cp.page_id
           WHERE cp.card_id = ? ORDER BY cp.created_at, p.id`,
        )
        .all(id) as {
        id: string;
        title: string;
        section_id: string;
        type: 'markdown' | 'rich';
        deleted_at: number | null;
      }[]
    ).map((p): CardPage => ({
      pageId: p.id,
      title: p.title,
      sectionId: p.section_id,
      type: p.type,
      deleted: p.deleted_at !== null,
    }));
    const activity = (
      this.db
        .prepare(
          `SELECT a.id, a.type, a.payload_json, coalesce(u.display_name, 'Someone') AS author, a.created_at
           FROM card_activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.card_id = ? ORDER BY a.created_at DESC, a.id DESC
           LIMIT 200`,
        )
        .all(id) as {
        id: string;
        type: ActivityType;
        payload_json: string;
        author: string;
        created_at: number;
      }[]
    ).map((a): CardActivity => ({
      id: a.id,
      type: a.type,
      payload: JSON.parse(a.payload_json) as Record<string, unknown>,
      author: a.author,
      createdAt: a.created_at,
    }));
    return {
      card: this.face(id),
      key: `${project.key}-${row.number}`,
      description: row.description,
      checklists,
      comments,
      attachments,
      pages,
      activity,
    };
  }

  /** A card by its key (`WEB-42`), for links from notes. */
  cardByKey(owner: string, key: string): { id: string; boardId: string } {
    const match = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/.exec(key.toUpperCase());
    if (!match) throw notFound('Card not found.');
    const row = this.db
      .prepare(
        `SELECT c.id, c.board_id FROM cards c JOIN boards b ON b.id = c.board_id JOIN projects p ON p.id = b.project_id
         WHERE p.owner_id = ? AND p.key = ? AND c.number = ?`,
      )
      .get(owner, match[1], Number(match[2])) as { id: string; board_id: string } | undefined;
    if (!row) throw notFound('Card not found.');
    return { id: row.id, boardId: row.board_id };
  }

  // Labels

  createLabel(owner: string, projectId: string, body: { name: string; color: ColorId }): Label {
    this.projectRow(owner, projectId);
    const id = uuidv7(this.now());
    this.db
      .prepare(
        'INSERT INTO labels (id, owner_id, project_id, name, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, owner, projectId, body.name, body.color, this.now());
    return { id, projectId, name: body.name, color: body.color };
  }

  private labelRow(owner: string, id: string) {
    const row = this.db
      .prepare('SELECT * FROM labels WHERE id = ? AND owner_id = ?')
      .get(id, owner) as
      { id: string; project_id: string; name: string; color: string } | undefined;
    if (!row) throw notFound('Label not found.');
    return row;
  }

  updateLabel(owner: string, id: string, patch: { name?: string; color?: ColorId }): Label {
    const row = this.labelRow(owner, id);
    const name = patch.name ?? row.name;
    const color = (patch.color ?? row.color) as ColorId;
    this.db.prepare('UPDATE labels SET name = ?, color = ? WHERE id = ?').run(name, color, id);
    return { id, projectId: row.project_id, name, color };
  }

  deleteLabel(owner: string, id: string): { projectId: string } {
    const row = this.labelRow(owner, id);
    this.db.prepare('DELETE FROM labels WHERE id = ?').run(id);
    return { projectId: row.project_id };
  }

  // Checklists

  addChecklist(actor: Actor, cardId: string, title: string): { boardId: string } {
    return this.tx(() => {
      const card = this.cardRow(actor.owner, cardId);
      const siblings = this.db
        .prepare('SELECT id, sort_key FROM checklists WHERE card_id = ?')
        .all(cardId) as { id: string; sort_key: string }[];
      this.db
        .prepare(
          'INSERT INTO checklists (id, owner_id, card_id, title, sort_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          uuidv7(this.now()),
          actor.owner,
          cardId,
          title,
          this.place(siblings, null),
          this.now(),
        );
      this.touchCard(cardId);
      return { boardId: card.board_id };
    });
  }

  private checklistRow(owner: string, id: string) {
    const row = this.db
      .prepare(
        `SELECT l.id, l.card_id, c.board_id FROM checklists l JOIN cards c ON c.id = l.card_id
         WHERE l.id = ? AND l.owner_id = ?`,
      )
      .get(id, owner) as { id: string; card_id: string; board_id: string } | undefined;
    if (!row) throw notFound('Checklist not found.');
    return row;
  }

  renameChecklist(owner: string, id: string, title: string): { boardId: string; cardId: string } {
    const row = this.checklistRow(owner, id);
    this.db.prepare('UPDATE checklists SET title = ? WHERE id = ?').run(title, id);
    return { boardId: row.board_id, cardId: row.card_id };
  }

  deleteChecklist(owner: string, id: string): { boardId: string; cardId: string } {
    const row = this.checklistRow(owner, id);
    this.db.prepare('DELETE FROM checklists WHERE id = ?').run(id);
    this.touchCard(row.card_id);
    return { boardId: row.board_id, cardId: row.card_id };
  }

  addItem(owner: string, checklistId: string, text: string): { boardId: string; cardId: string } {
    return this.tx(() => {
      const list = this.checklistRow(owner, checklistId);
      const siblings = this.db
        .prepare('SELECT id, sort_key FROM checklist_items WHERE checklist_id = ?')
        .all(checklistId) as { id: string; sort_key: string }[];
      this.db
        .prepare(
          'INSERT INTO checklist_items (id, owner_id, checklist_id, text, done, sort_key, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)',
        )
        .run(uuidv7(this.now()), owner, checklistId, text, this.place(siblings, null), this.now());
      this.touchCard(list.card_id);
      return { boardId: list.board_id, cardId: list.card_id };
    });
  }

  private itemRow(owner: string, id: string) {
    const row = this.db
      .prepare('SELECT * FROM checklist_items WHERE id = ? AND owner_id = ?')
      .get(id, owner) as
      | { id: string; checklist_id: string; text: string; done: number; sort_key: string }
      | undefined;
    if (!row) throw notFound('Item not found.');
    return row;
  }

  updateItem(
    owner: string,
    id: string,
    patch: Partial<{ text: string; done: boolean; checklistId: string; beforeId: string | null }>,
  ): { boardId: string; cardId: string } {
    return this.tx(() => {
      const row = this.itemRow(owner, id);
      const from = this.checklistRow(owner, row.checklist_id);
      const listId = patch.checklistId ?? row.checklist_id;
      const to = this.checklistRow(owner, listId);
      if (to.card_id !== from.card_id)
        throw new ApiError(422, 'invalid_move', 'Items stay on their card.');
      let sortKey = row.sort_key;
      if (patch.beforeId !== undefined || patch.checklistId !== undefined) {
        const siblings = this.db
          .prepare('SELECT id, sort_key FROM checklist_items WHERE checklist_id = ?')
          .all(listId) as { id: string; sort_key: string }[];
        sortKey = this.place(siblings, patch.beforeId ?? null, id);
      }
      this.db
        .prepare(
          'UPDATE checklist_items SET text = ?, done = ?, checklist_id = ?, sort_key = ? WHERE id = ?',
        )
        .run(patch.text ?? row.text, (patch.done ?? !!row.done) ? 1 : 0, listId, sortKey, id);
      this.touchCard(from.card_id);
      return { boardId: from.board_id, cardId: from.card_id };
    });
  }

  deleteItem(owner: string, id: string): { boardId: string; cardId: string } {
    const row = this.itemRow(owner, id);
    const list = this.checklistRow(owner, row.checklist_id);
    this.db.prepare('DELETE FROM checklist_items WHERE id = ?').run(id);
    this.touchCard(list.card_id);
    return { boardId: list.board_id, cardId: list.card_id };
  }

  // Comments

  addComment(actor: Actor, cardId: string, body: string): { boardId: string } {
    return this.tx(() => {
      const card = this.cardRow(actor.owner, cardId);
      this.db
        .prepare(
          'INSERT INTO card_comments (id, owner_id, card_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(uuidv7(this.now()), actor.owner, cardId, actor.userId, body, this.now());
      this.log(actor, cardId, 'commented');
      this.touchCard(cardId);
      return { boardId: card.board_id };
    });
  }

  private commentRow(owner: string, id: string) {
    const row = this.db
      .prepare(
        `SELECT m.id, m.card_id, c.board_id FROM card_comments m JOIN cards c ON c.id = m.card_id
         WHERE m.id = ? AND m.owner_id = ?`,
      )
      .get(id, owner) as { id: string; card_id: string; board_id: string } | undefined;
    if (!row) throw notFound('Comment not found.');
    return row;
  }

  editComment(owner: string, id: string, body: string): { boardId: string; cardId: string } {
    const row = this.commentRow(owner, id);
    this.db
      .prepare('UPDATE card_comments SET body = ?, edited_at = ? WHERE id = ?')
      .run(body, this.now(), id);
    return { boardId: row.board_id, cardId: row.card_id };
  }

  deleteComment(owner: string, id: string): { boardId: string; cardId: string } {
    const row = this.commentRow(owner, id);
    this.db.prepare('DELETE FROM card_comments WHERE id = ?').run(id);
    return { boardId: row.board_id, cardId: row.card_id };
  }

  // Linked notes and files

  linkPage(actor: Actor, cardId: string, pageId: string): { boardId: string } {
    return this.tx(() => {
      const card = this.cardRow(actor.owner, cardId);
      const page = this.db
        .prepare('SELECT id, title FROM pages WHERE id = ? AND owner_id = ? AND deleted_at IS NULL')
        .get(pageId, actor.owner) as { id: string; title: string } | undefined;
      if (!page) throw notFound('Page not found.');
      const added = this.db
        .prepare('INSERT OR IGNORE INTO card_pages (card_id, page_id, created_at) VALUES (?, ?, ?)')
        .run(cardId, pageId, this.now()).changes;
      if (added) {
        this.log(actor, cardId, 'note_linked', { title: page.title });
        this.touchCard(cardId);
      }
      return { boardId: card.board_id };
    });
  }

  unlinkPage(actor: Actor, cardId: string, pageId: string): { boardId: string } {
    return this.tx(() => {
      const card = this.cardRow(actor.owner, cardId);
      const page = this.db
        .prepare('SELECT title FROM pages WHERE id = ? AND owner_id = ?')
        .get(pageId, actor.owner) as { title: string } | undefined;
      const removed = this.db
        .prepare('DELETE FROM card_pages WHERE card_id = ? AND page_id = ?')
        .run(cardId, pageId).changes;
      if (!removed) throw notFound('That note isn’t linked to this card.');
      this.log(actor, cardId, 'note_unlinked', { title: page?.title ?? '' });
      this.touchCard(cardId);
      return { boardId: card.board_id };
    });
  }

  /** The cards a note is linked to, with where they are. */
  pageCards(owner: string, pageId: string): LinkedCard[] {
    const page = this.db
      .prepare('SELECT id FROM pages WHERE id = ? AND owner_id = ?')
      .get(pageId, owner);
    if (!page) throw notFound('Page not found.');
    return (
      this.db
        .prepare(
          `SELECT c.id, p.key || '-' || c.number AS key, c.title, c.board_id, b.name AS board_name, col.name AS column_name,
             c.completed_at, c.archived_at
           FROM card_pages cp JOIN cards c ON c.id = cp.card_id JOIN boards b ON b.id = c.board_id
           JOIN projects p ON p.id = b.project_id JOIN board_columns col ON col.id = c.column_id
           WHERE cp.page_id = ? AND c.owner_id = ? ORDER BY cp.created_at, c.id`,
        )
        .all(pageId, owner) as {
        id: string;
        key: string;
        title: string;
        board_id: string;
        board_name: string;
        column_name: string;
        completed_at: number | null;
        archived_at: number | null;
      }[]
    ).map((r) => ({
      id: r.id,
      key: r.key,
      title: r.title,
      boardId: r.board_id,
      boardName: r.board_name,
      columnName: r.column_name,
      completedAt: r.completed_at,
      archivedAt: r.archived_at,
    }));
  }

  attach(actor: Actor, cardId: string, assetId: string): { boardId: string } {
    return this.tx(() => {
      const card = this.cardRow(actor.owner, cardId);
      const asset = this.db
        .prepare('SELECT original_name AS name FROM assets WHERE id = ? AND owner_id = ?')
        .get(assetId, actor.owner) as { name: string } | undefined;
      if (!asset) throw notFound('File not found.');
      const siblings = this.db
        .prepare('SELECT asset_id AS id, sort_key FROM card_attachments WHERE card_id = ?')
        .all(cardId) as { id: string; sort_key: string }[];
      const added = this.db
        .prepare(
          'INSERT OR IGNORE INTO card_attachments (card_id, asset_id, sort_key, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(cardId, assetId, this.place(siblings, null), this.now()).changes;
      if (added) {
        this.log(actor, cardId, 'attached', { name: asset.name });
        this.touchCard(cardId);
      }
      return { boardId: card.board_id };
    });
  }

  detach(owner: string, cardId: string, assetId: string): { boardId: string } {
    const card = this.cardRow(owner, cardId);
    const removed = this.db
      .prepare('DELETE FROM card_attachments WHERE card_id = ? AND asset_id = ?')
      .run(cardId, assetId).changes;
    if (!removed) throw notFound('That file isn’t attached to this card.');
    this.touchCard(cardId);
    return { boardId: card.board_id };
  }
}
