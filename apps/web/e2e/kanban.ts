import {
  BOARD_TEMPLATE_COLUMNS,
  keysBetween,
  MARK_END,
  MARK_START,
  type ActivityType,
  type Board,
  type BoardData,
  type BoardTemplate,
  type Card,
  type CardActivity,
  type CardDetail,
  type CardHit,
  type Checklist,
  type ChecklistItem,
  type CardComment,
  type ColorId,
  type Column,
  type Label,
  type LinkedCard,
  type Priority,
  type Project,
  type ServerEvent,
  type Swimlane,
} from '@memora/shared';

/*
 * The Kanban part of the fake server (§9.11): projects, boards, columns, lanes and cards in
 * memory, changed by the real server's rules (sort keys, WIP limits, Done columns, card
 * numbers per project), and told to the browsers the way the server tells them.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

interface Reply {
  status?: number;
  json?: unknown;
}

const error = (status: number, code: string, message: string): Reply => ({
  status,
  json: { error: { code, message } },
});
const notFound = (what: string) => error(404, 'not_found', `${what} not found.`);

class Refused extends Error {
  constructor(readonly reply: Reply) {
    super('refused');
  }
}
const refuse = (reply: Reply): never => {
  throw new Refused(reply);
};

interface CardRow extends Omit<
  Card,
  'checklist' | 'comments' | 'attachments' | 'pages' | 'labelIds'
> {
  description: string;
  labelIds: string[];
}

interface ProjectRow extends Project {
  next: number;
}

/** What the notes part knows about a page. */
export interface PageInfo {
  title: string;
  sectionId: string;
  type: 'markdown' | 'rich';
  deleted: boolean;
}

interface Sortable {
  id: string;
  sortKey: string;
}

const bySortKey = (a: Sortable, b: Sortable) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1;

/** Where an item goes among its siblings: before `beforeId`, or last. */
function place(siblings: Sortable[], beforeId: string | null, self?: string): string {
  const list = siblings.filter((s) => s.id !== self).sort(bySortKey);
  const index = beforeId ? list.findIndex((s) => s.id === beforeId) : -1;
  if (beforeId && index < 0) refuse(error(422, 'invalid_move', 'That place no longer exists.'));
  const before = index < 0 ? (list.at(-1)?.sortKey ?? null) : (list[index - 1]?.sortKey ?? null);
  const after = index < 0 ? null : list[index]!.sortKey;
  return keysBetween(before, after, 1)[0]!;
}

export interface SeedCard {
  title: string;
  column: number;
  lane?: string;
  priority?: Priority;
  dueDate?: string;
  labels?: string[];
  description?: string;
  pages?: string[];
  checklist?: [string, boolean][];
  comments?: string[];
  completed?: boolean;
  archived?: boolean;
}

export class FakeKanban {
  projects: ProjectRow[] = [];
  boards: Board[] = [];
  labels: (Label & { createdAt: number })[] = [];
  columns: Column[] = [];
  lanes: Swimlane[] = [];
  cards: CardRow[] = [];
  checklists: { id: string; cardId: string; title: string; sortKey: string }[] = [];
  items: ChecklistItem[] = [];
  comments: CardComment[] = [];
  links: { cardId: string; pageId: string; createdAt: number }[] = [];
  attachments: { cardId: string; assetId: string; sortKey: string; createdAt: number }[] = [];
  activity: (CardActivity & { cardId: string })[] = [];
  /** Told about every change, like the server's event hub. */
  publish: (event: ServerEvent) => void = () => {};
  /** Looks a page up in the notes part. */
  pageOf: (id: string) => PageInfo | null = () => null;
  /** Looks an uploaded file up. */
  fileOf: (id: string) => { name: string; type: string; size: number } | null = () => null;
  author = 'Alex Morgan';
  private nextId = 1;
  private tick = 0;

  constructor(
    private readonly start: number,
    seed = true,
  ) {
    if (seed) this.seedDemo();
  }

  private now() {
    return this.start + this.tick++;
  }

  private id(prefix: string) {
    return `${prefix}-${String(this.nextId++).padStart(5, '0')}`;
  }

  respond(method: string, path: string, body: Record<string, unknown>, origin: string | null) {
    const m = path.match(/^\/api\/v1\/(.+)$/);
    if (!m) return null;
    const parts = m[1]!.split('/');
    const kinds = [
      'projects',
      'labels',
      'boards',
      'columns',
      'lanes',
      'cards',
      'checklists',
      'checklist-items',
      'comments',
    ];
    const pageCards = parts[0] === 'pages' && parts[2] === 'cards' && parts.length === 3;
    if (!kinds.includes(parts[0]!) && !pageCards) return null;
    try {
      return this.route(method, parts, body, origin);
    } catch (err) {
      if (err instanceof Refused) return err.reply;
      throw err;
    }
  }

  private route(
    method: string,
    [kind, id, sub, other]: string[],
    body: Record<string, unknown>,
    origin: string | null,
  ): Reply | null {
    const projectsChanged = () => this.publish({ type: 'projects.changed', origin });
    const boardChanged = (boardId: string, cardId?: string) =>
      this.publish({ type: 'board.changed', boardId, ...(cardId ? { cardId } : {}), origin });
    const cardAfter = (cardId: string, status = 200): Reply => {
      const card = this.cardRow(cardId);
      boardChanged(card.boardId, cardId);
      return { status, json: this.detail(cardId) };
    };
    const route = `${method} ${kind}${id ? '/:id' : ''}${sub ? `/${sub}` : ''}${other ? '/:other' : ''}`;
    switch (route) {
      case 'GET projects':
        return { json: this.list() };
      case 'POST projects': {
        const made = this.createProject(body);
        projectsChanged();
        return { status: 201, json: made };
      }
      case 'PATCH projects/:id': {
        const project = this.updateProject(id!, body);
        projectsChanged();
        return { json: this.toProject(project) };
      }
      case 'DELETE projects/:id': {
        this.project(id!);
        for (const board of this.boards.filter((b) => b.projectId === id)) this.dropBoard(board.id);
        this.projects = this.projects.filter((p) => p.id !== id);
        this.labels = this.labels.filter((l) => l.projectId !== id);
        projectsChanged();
        return { status: 204 };
      }
      case 'POST projects/:id/labels': {
        this.project(id!);
        const label = {
          id: this.id('label'),
          projectId: id!,
          name: String(body.name).trim(),
          color: body.color as ColorId,
          createdAt: this.now(),
        };
        this.labels.push(label);
        projectsChanged();
        return { status: 201, json: this.toLabel(label) };
      }
      case 'PATCH labels/:id': {
        const label = this.labels.find((l) => l.id === id) ?? refuse(notFound('Label'));
        if (body.name !== undefined) label.name = String(body.name).trim();
        if (body.color !== undefined) label.color = body.color as ColorId;
        projectsChanged();
        return { json: this.toLabel(label) };
      }
      case 'DELETE labels/:id': {
        if (!this.labels.some((l) => l.id === id)) return notFound('Label');
        this.labels = this.labels.filter((l) => l.id !== id);
        for (const card of this.cards) card.labelIds = card.labelIds.filter((l) => l !== id);
        projectsChanged();
        return { status: 204 };
      }
      case 'POST boards': {
        this.project(String(body.projectId));
        const board = this.createBoard(
          String(body.projectId),
          String(body.name).trim(),
          (body.template as BoardTemplate | undefined) ?? 'basic',
        );
        projectsChanged();
        return { status: 201, json: board };
      }
      case 'GET boards/:id':
        return { json: this.board(id!, body.archived === '1') };
      case 'PATCH boards/:id': {
        const board = this.boardOf(id!);
        if (body.beforeId !== undefined) {
          board.sortKey = place(
            this.boards.filter((b) => b.projectId === board.projectId),
            body.beforeId as string | null,
            board.id,
          );
        }
        if (body.name !== undefined) board.name = String(body.name).trim();
        if (body.description !== undefined) board.description = String(body.description);
        if (body.lanes !== undefined)
          board.settings = { ...board.settings, lanes: body.lanes as Board['settings']['lanes'] };
        if (body.archived !== undefined) board.archivedAt = body.archived ? this.now() : null;
        board.updatedAt = this.now();
        projectsChanged();
        boardChanged(board.id);
        return { json: { ...board } };
      }
      case 'DELETE boards/:id': {
        this.boardOf(id!);
        this.dropBoard(id!);
        projectsChanged();
        return { status: 204 };
      }
      case 'POST boards/:id/columns': {
        this.boardOf(id!);
        const column = this.addColumn(id!, String(body.name).trim(), false, body.beforeId as never);
        boardChanged(id!);
        return { status: 201, json: { ...column } };
      }
      case 'PATCH columns/:id': {
        const column = this.updateColumn(id!, body);
        boardChanged(column.boardId);
        return { json: { ...column } };
      }
      case 'DELETE columns/:id': {
        const column = this.column(id!);
        this.columns = this.columns.filter((c) => c.id !== id);
        for (const card of this.cards.filter((c) => c.columnId === id)) this.dropCard(card.id);
        boardChanged(column.boardId);
        return { status: 204 };
      }
      case 'POST boards/:id/lanes': {
        this.boardOf(id!);
        const lane: Swimlane = {
          id: this.id('lane'),
          boardId: id!,
          name: String(body.name).trim(),
          color: null,
          collapsed: false,
          sortKey: place(
            this.lanes.filter((l) => l.boardId === id),
            (body.beforeId as string | null | undefined) ?? null,
          ),
        };
        this.lanes.push(lane);
        boardChanged(id!);
        return { status: 201, json: { ...lane } };
      }
      case 'PATCH lanes/:id': {
        const lane = this.lanes.find((l) => l.id === id) ?? refuse(notFound('Swimlane'));
        if (body.beforeId !== undefined) {
          lane.sortKey = place(
            this.lanes.filter((l) => l.boardId === lane.boardId),
            body.beforeId as string | null,
            lane.id,
          );
        }
        if (body.name !== undefined) lane.name = String(body.name).trim();
        if (body.color !== undefined) lane.color = body.color as ColorId | null;
        if (body.collapsed !== undefined) lane.collapsed = !!body.collapsed;
        boardChanged(lane.boardId);
        return { status: 204 };
      }
      case 'DELETE lanes/:id': {
        const lane = this.lanes.find((l) => l.id === id) ?? refuse(notFound('Swimlane'));
        this.lanes = this.lanes.filter((l) => l.id !== id);
        for (const card of this.cards) if (card.swimlaneId === id) card.swimlaneId = null;
        boardChanged(lane.boardId);
        return { status: 204 };
      }
      case 'POST cards': {
        const card = this.createCard(body);
        boardChanged(card.boardId, card.id);
        return { status: 201, json: card };
      }
      case 'GET cards/:id':
        return { json: this.detail(id!) };
      case 'PATCH cards/:id': {
        const card = this.updateCard(id!, body);
        boardChanged(card.boardId, card.id);
        return { json: card };
      }
      case 'POST cards/:id/move': {
        const from = this.cardRow(id!).boardId;
        const card = this.moveCard(id!, body);
        boardChanged(card.boardId, card.id);
        if (from !== card.boardId) boardChanged(from, card.id);
        return { json: card };
      }
      case 'POST cards/:id/duplicate': {
        const card = this.duplicateCard(id!);
        boardChanged(card.boardId, card.id);
        return { status: 201, json: card };
      }
      case 'DELETE cards/:id': {
        const card = this.cardRow(id!);
        this.dropCard(id!);
        boardChanged(card.boardId, id);
        return { status: 204 };
      }
      case 'POST cards/:id/checklists': {
        this.cardRow(id!);
        this.checklists.push({
          id: this.id('list'),
          cardId: id!,
          title: String(body.title).trim(),
          sortKey: place(
            this.checklists.filter((l) => l.cardId === id),
            null,
          ),
        });
        return cardAfter(id!, 201);
      }
      case 'PATCH checklists/:id': {
        const list = this.checklist(id!);
        list.title = String(body.title).trim();
        return cardAfter(list.cardId);
      }
      case 'DELETE checklists/:id': {
        const list = this.checklist(id!);
        this.checklists = this.checklists.filter((l) => l.id !== id);
        this.items = this.items.filter((i) => i.checklistId !== id);
        return cardAfter(list.cardId);
      }
      case 'POST checklists/:id/items': {
        const list = this.checklist(id!);
        this.items.push({
          id: this.id('item'),
          checklistId: id!,
          text: String(body.text).trim(),
          done: false,
          sortKey: place(
            this.items.filter((i) => i.checklistId === id),
            null,
          ),
        });
        return cardAfter(list.cardId, 201);
      }
      case 'PATCH checklist-items/:id': {
        const item = this.items.find((i) => i.id === id) ?? refuse(notFound('Item'));
        const from = this.checklist(item.checklistId);
        const to = this.checklist((body.checklistId as string | undefined) ?? item.checklistId);
        if (to.cardId !== from.cardId)
          return error(422, 'invalid_move', 'Items stay on their card.');
        if (body.beforeId !== undefined || body.checklistId !== undefined) {
          item.sortKey = place(
            this.items.filter((i) => i.checklistId === to.id),
            (body.beforeId as string | null | undefined) ?? null,
            item.id,
          );
          item.checklistId = to.id;
        }
        if (body.text !== undefined) item.text = String(body.text).trim();
        if (body.done !== undefined) item.done = !!body.done;
        return cardAfter(from.cardId);
      }
      case 'DELETE checklist-items/:id': {
        const item = this.items.find((i) => i.id === id) ?? refuse(notFound('Item'));
        this.items = this.items.filter((i) => i.id !== id);
        return cardAfter(this.checklist(item.checklistId).cardId);
      }
      case 'POST cards/:id/comments': {
        this.cardRow(id!);
        this.comments.push({
          id: this.id('comment'),
          cardId: id!,
          userId: 'u-alex',
          author: this.author,
          body: String(body.body).trim(),
          createdAt: this.now(),
          editedAt: null,
        });
        this.log(id!, 'commented');
        return cardAfter(id!, 201);
      }
      case 'PATCH comments/:id': {
        const comment = this.comments.find((c) => c.id === id) ?? refuse(notFound('Comment'));
        comment.body = String(body.body).trim();
        comment.editedAt = this.now();
        return cardAfter(comment.cardId);
      }
      case 'DELETE comments/:id': {
        const comment = this.comments.find((c) => c.id === id) ?? refuse(notFound('Comment'));
        this.comments = this.comments.filter((c) => c.id !== id);
        return cardAfter(comment.cardId);
      }
      case 'PUT cards/:id/pages/:other': {
        this.cardRow(id!);
        const page = this.pageOf(other!);
        if (!page || page.deleted) return notFound('Page');
        if (!this.links.some((l) => l.cardId === id && l.pageId === other)) {
          this.links.push({ cardId: id!, pageId: other!, createdAt: this.now() });
          this.log(id!, 'note_linked', { title: page.title });
        }
        return cardAfter(id!);
      }
      case 'DELETE cards/:id/pages/:other': {
        this.cardRow(id!);
        const linked = this.links.some((l) => l.cardId === id && l.pageId === other);
        if (!linked) return error(404, 'not_found', 'That note isn’t linked to this card.');
        this.links = this.links.filter((l) => !(l.cardId === id && l.pageId === other));
        this.log(id!, 'note_unlinked', { title: this.pageOf(other!)?.title ?? '' });
        return cardAfter(id!);
      }
      case 'GET pages/:id/cards':
        return { json: { cards: this.pageCards(id!) } };
      case 'POST cards/:id/attachments': {
        this.cardRow(id!);
        const assetId = String(body.assetId);
        const file = this.fileOf(assetId);
        if (!file) return notFound('File');
        if (!this.attachments.some((a) => a.cardId === id && a.assetId === assetId)) {
          this.attachments.push({
            cardId: id!,
            assetId,
            sortKey: place(
              this.attachments
                .filter((a) => a.cardId === id)
                .map((a) => ({ id: a.assetId, sortKey: a.sortKey })),
              null,
            ),
            createdAt: this.now(),
          });
          this.log(id!, 'attached', { name: file.name });
        }
        return cardAfter(id!, 201);
      }
      case 'DELETE cards/:id/attachments/:other': {
        this.cardRow(id!);
        if (!this.attachments.some((a) => a.cardId === id && a.assetId === other))
          return error(404, 'not_found', 'That file isn’t attached to this card.');
        this.attachments = this.attachments.filter(
          (a) => !(a.cardId === id && a.assetId === other),
        );
        return cardAfter(id!);
      }
      default: {
        if (method === 'GET' && kind === 'cards' && id === 'by-key' && sub) {
          return { json: this.byKey(decodeURIComponent(sub)) };
        }
        return null;
      }
    }
  }

  // Reading

  private project(id: string): ProjectRow {
    return this.projects.find((p) => p.id === id) ?? refuse(notFound('Project'));
  }

  private boardOf(id: string): Board {
    return this.boards.find((b) => b.id === id) ?? refuse(notFound('Board'));
  }

  private column(id: string): Column {
    return this.columns.find((c) => c.id === id) ?? refuse(notFound('Column'));
  }

  private cardRow(id: string): CardRow {
    return this.cards.find((c) => c.id === id) ?? refuse(notFound('Card'));
  }

  private checklist(id: string) {
    return this.checklists.find((l) => l.id === id) ?? refuse(notFound('Checklist'));
  }

  private projectOfBoard(boardId: string): ProjectRow {
    return this.project(this.boardOf(boardId).projectId);
  }

  private toProject({ next: _, ...project }: ProjectRow): Project {
    return { ...project };
  }

  private toLabel({ createdAt: _, ...label }: Label & { createdAt: number }): Label {
    return { ...label };
  }

  list() {
    return {
      projects: [...this.projects].sort(bySortKey).map((p) => this.toProject(p)),
      boards: [...this.boards].sort(bySortKey).map((b) => ({ ...b })),
      labels: this.labels.map((l) => this.toLabel(l)),
    };
  }

  face(row: CardRow): Card {
    const lists = new Set(this.checklists.filter((l) => l.cardId === row.id).map((l) => l.id));
    const items = this.items.filter((i) => lists.has(i.checklistId));
    const labelOrder = this.labels.map((l) => l.id);
    const { description: _, ...rest } = row;
    return {
      ...rest,
      labelIds: [...row.labelIds].sort((a, b) => labelOrder.indexOf(a) - labelOrder.indexOf(b)),
      checklist: { done: items.filter((i) => i.done).length, total: items.length },
      comments: this.comments.filter((c) => c.cardId === row.id).length,
      attachments: this.attachments.filter((a) => a.cardId === row.id).length,
      pages: this.links.filter(
        (l) => l.cardId === row.id && this.pageOf(l.pageId)?.deleted === false,
      ).length,
    };
  }

  board(id: string, archived = false): BoardData {
    const board = this.boardOf(id);
    const project = this.project(board.projectId);
    return {
      board: { ...board },
      project: this.toProject(project),
      labels: this.labels.filter((l) => l.projectId === project.id).map((l) => this.toLabel(l)),
      columns: this.columns
        .filter((c) => c.boardId === id)
        .sort(bySortKey)
        .map((c) => ({ ...c })),
      swimlanes: this.lanes
        .filter((l) => l.boardId === id)
        .sort(bySortKey)
        .map((l) => ({ ...l })),
      cards: this.cards
        .filter((c) => c.boardId === id && !!c.archivedAt === archived)
        .sort(bySortKey)
        .map((c) => this.face(c)),
    };
  }

  detail(id: string): CardDetail {
    const row = this.cardRow(id);
    const project = this.projectOfBoard(row.boardId);
    const checklists: Checklist[] = this.checklists
      .filter((l) => l.cardId === id)
      .sort(bySortKey)
      .map((l) => ({
        ...l,
        items: this.items
          .filter((i) => i.checklistId === l.id)
          .sort(bySortKey)
          .map((i) => ({ ...i })),
      }));
    return {
      card: this.face(row),
      key: `${project.key}-${row.number}`,
      description: row.description,
      checklists,
      comments: this.comments.filter((c) => c.cardId === id).map((c) => ({ ...c })),
      attachments: this.attachments
        .filter((a) => a.cardId === id)
        .map((a) => {
          const file = this.fileOf(a.assetId);
          return {
            assetId: a.assetId,
            name: file?.name ?? 'file',
            mime: file?.type ?? 'application/octet-stream',
            size: file?.size ?? 0,
            createdAt: a.createdAt,
          };
        }),
      pages: this.links
        .filter((l) => l.cardId === id)
        .flatMap((l) => {
          const page = this.pageOf(l.pageId);
          return page
            ? [
                {
                  pageId: l.pageId,
                  title: page.title,
                  sectionId: page.sectionId,
                  type: page.type,
                  deleted: page.deleted,
                },
              ]
            : [];
        }),
      activity: this.activity
        .filter((a) => a.cardId === id)
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
        .map(({ cardId: _, ...a }) => a),
    };
  }

  private byKey(key: string) {
    const match = /^([A-Z][A-Z0-9]{1,9})-(\d+)$/.exec(key.toUpperCase());
    const project = match && this.projects.find((p) => p.key === match[1]);
    const boards = new Set(this.boards.filter((b) => b.projectId === project?.id).map((b) => b.id));
    const card = this.cards.find((c) => boards.has(c.boardId) && c.number === Number(match![2]));
    return card ? { id: card.id, boardId: card.boardId } : refuse(notFound('Card'));
  }

  pageCards(pageId: string): LinkedCard[] {
    if (!this.pageOf(pageId)) refuse(notFound('Page'));
    return this.links
      .filter((l) => l.pageId === pageId)
      .flatMap((l) => {
        const card = this.cards.find((c) => c.id === l.cardId);
        if (!card) return [];
        const board = this.boardOf(card.boardId);
        return [
          {
            id: card.id,
            key: `${this.project(board.projectId).key}-${card.number}`,
            title: card.title,
            boardId: board.id,
            boardName: board.name,
            columnName: this.column(card.columnId).name,
            completedAt: card.completedAt,
            archivedAt: card.archivedAt,
          },
        ];
      });
  }

  /** Cards whose title, key or description has every word, for search with cards. */
  search(q: string): CardHit[] {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const mark = (text: string) =>
      words.reduce(
        (acc, w) =>
          acc.replace(
            new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
            (m) => `${MARK_START}${m}${MARK_END}`,
          ),
        text,
      );
    return this.cards.flatMap((card) => {
      const board = this.boardOf(card.boardId);
      const key = `${this.project(board.projectId).key}-${card.number}`;
      const text = `${key} ${card.title} ${card.description}`.toLowerCase();
      if (!words.every((w) => text.includes(w))) return [];
      return [
        {
          id: card.id,
          key,
          title: mark(card.title),
          snippet: mark(card.description.slice(0, 160)),
          boardId: board.id,
          boardName: board.name,
          columnName: this.column(card.columnId).name,
          completedAt: card.completedAt,
        },
      ];
    });
  }

  // Changing

  private log(cardId: string, type: ActivityType, payload: Record<string, unknown> = {}) {
    this.activity.push({
      id: this.id('act'),
      cardId,
      type,
      payload,
      author: this.author,
      createdAt: this.now(),
    });
  }

  private createProject(body: Record<string, unknown>) {
    const key = String(body.key);
    if (this.projects.some((p) => p.key === key))
      return refuse(error(409, 'key_taken', `Another project already uses the key ${key}.`));
    const now = this.now();
    const project: ProjectRow = {
      id: this.id('project'),
      name: String(body.name).trim(),
      key,
      color: body.color as ColorId,
      icon: (body.icon as Project['icon'] | undefined) ?? 'square-kanban',
      sortKey: place(this.projects, null),
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      next: 1,
    };
    this.projects.push(project);
    const board = this.createBoard(
      project.id,
      'Board',
      (body.template as BoardTemplate | undefined) ?? 'basic',
    );
    return { project: this.toProject(project), board };
  }

  private updateProject(id: string, body: Record<string, unknown>) {
    const project = this.project(id);
    if (body.key !== undefined && body.key !== project.key) {
      if (this.projects.some((p) => p.key === body.key && p.id !== id))
        refuse(
          error(409, 'key_taken', `Another project already uses the key ${String(body.key)}.`),
        );
      project.key = String(body.key);
    }
    if (body.beforeId !== undefined)
      project.sortKey = place(this.projects, body.beforeId as string | null, id);
    if (body.name !== undefined) project.name = String(body.name).trim();
    if (body.color !== undefined) project.color = body.color as ColorId;
    if (body.icon !== undefined) project.icon = body.icon as Project['icon'];
    if (body.archived !== undefined) project.archivedAt = body.archived ? this.now() : null;
    project.updatedAt = this.now();
    return project;
  }

  createBoard(projectId: string, name: string, template: BoardTemplate, id?: string): Board {
    const now = this.now();
    const board: Board = {
      id: id ?? this.id('board'),
      projectId,
      name,
      description: '',
      sortKey: place(
        this.boards.filter((b) => b.projectId === projectId),
        null,
      ),
      settings: { lanes: 'none' },
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.boards.push(board);
    const names = BOARD_TEMPLATE_COLUMNS[template];
    names.forEach((n, i) => this.addColumn(board.id, n, i === names.length - 1));
    return { ...board };
  }

  addColumn(boardId: string, name: string, isDone = false, beforeId: string | null = null) {
    const column: Column = {
      id: this.id('column'),
      boardId,
      name,
      color: null,
      wipLimit: null,
      wipStrict: false,
      isDone,
      collapsed: false,
      sort: 'manual',
      sortKey: place(
        this.columns.filter((c) => c.boardId === boardId),
        beforeId ?? null,
      ),
      archivedAt: null,
    };
    this.columns.push(column);
    return column;
  }

  private updateColumn(id: string, body: Record<string, unknown>) {
    const column = this.column(id);
    if (body.beforeId !== undefined) {
      column.sortKey = place(
        this.columns.filter((c) => c.boardId === column.boardId),
        body.beforeId as string | null,
        id,
      );
    }
    for (const field of ['name', 'color', 'wipLimit', 'wipStrict', 'collapsed', 'sort'] as const) {
      if (body[field] !== undefined) Object.assign(column, { [field]: body[field] });
    }
    if (body.archived !== undefined) column.archivedAt = body.archived ? this.now() : null;
    if (body.isDone !== undefined && body.isDone !== column.isDone) {
      column.isDone = !!body.isDone;
      // A column that becomes a Done column completes its cards, and the other way round.
      for (const card of this.cards.filter((c) => c.columnId === id)) {
        card.completedAt = column.isDone ? (card.completedAt ?? this.now()) : null;
      }
    }
    return column;
  }

  private dropBoard(id: string) {
    this.boards = this.boards.filter((b) => b.id !== id);
    this.columns = this.columns.filter((c) => c.boardId !== id);
    this.lanes = this.lanes.filter((l) => l.boardId !== id);
    for (const card of this.cards.filter((c) => c.boardId === id)) this.dropCard(card.id);
  }

  private dropCard(id: string) {
    this.cards = this.cards.filter((c) => c.id !== id);
    const lists = new Set(this.checklists.filter((l) => l.cardId === id).map((l) => l.id));
    this.checklists = this.checklists.filter((l) => l.cardId !== id);
    this.items = this.items.filter((i) => !lists.has(i.checklistId));
    this.comments = this.comments.filter((c) => c.cardId !== id);
    this.links = this.links.filter((l) => l.cardId !== id);
    this.attachments = this.attachments.filter((a) => a.cardId !== id);
    this.activity = this.activity.filter((a) => a.cardId !== id);
  }

  /** Refuses a card for a strict column that is full. */
  private checkWip(column: Column, except?: string) {
    if (!column.wipLimit || !column.wipStrict) return;
    const n = this.cards.filter(
      (c) => c.columnId === column.id && !c.archivedAt && c.id !== except,
    ).length;
    if (n >= column.wipLimit) {
      refuse(
        error(
          409,
          'wip_limit',
          `“${column.name}” is full: its limit is ${column.wipLimit} ${column.wipLimit === 1 ? 'card' : 'cards'}.`,
        ),
      );
    }
  }

  private cardKeyIn(columnId: string, beforeId: string | null, top: boolean, self?: string) {
    const siblings = this.cards.filter((c) => c.columnId === columnId && !c.archivedAt);
    if (top) {
      const first = siblings.filter((s) => s.id !== self).sort(bySortKey)[0];
      return place(siblings, first?.id ?? null, self);
    }
    return place(siblings, beforeId, self);
  }

  private laneIn(boardId: string, laneId: unknown): string | null {
    if (!laneId) return null;
    if (!this.lanes.some((l) => l.id === laneId && l.boardId === boardId))
      refuse(notFound('Swimlane'));
    return String(laneId);
  }

  createCard(body: Record<string, unknown>): Card {
    const column = this.column(String(body.columnId));
    const existing = body.id ? this.cards.find((c) => c.id === body.id) : undefined;
    if (existing) return this.face(existing);
    this.checkWip(column);
    const project = this.projectOfBoard(column.boardId);
    const now = this.now();
    const row: CardRow = {
      id: (body.id as string | undefined) ?? this.id('card'),
      boardId: column.boardId,
      columnId: column.id,
      swimlaneId: this.laneIn(column.boardId, body.swimlaneId),
      number: project.next++,
      title: String(body.title).trim(),
      description: '',
      priority: 'none',
      startDate: null,
      dueDate: null,
      coverColor: null,
      labelIds: [],
      sortKey: this.cardKeyIn(
        column.id,
        (body.beforeId as string | null | undefined) ?? null,
        !!body.top,
      ),
      completedAt: column.isDone ? now : null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.cards.push(row);
    this.log(row.id, 'created', { column: column.name });
    if (body.pageId) {
      const page = this.pageOf(String(body.pageId));
      if (page) {
        this.links.push({ cardId: row.id, pageId: String(body.pageId), createdAt: this.now() });
        this.log(row.id, 'note_linked', { title: page.title });
      }
    }
    return this.face(row);
  }

  private updateCard(id: string, body: Record<string, unknown>): Card {
    const row = this.cardRow(id);
    const now = this.now();
    if (body.title !== undefined && body.title !== row.title) {
      this.log(id, 'renamed', { from: row.title, to: body.title });
      row.title = String(body.title).trim();
    }
    if (body.description !== undefined && body.description !== row.description) {
      this.log(id, 'described');
      row.description = String(body.description);
    }
    if (body.priority !== undefined && body.priority !== row.priority) {
      this.log(id, 'priority_changed', { from: row.priority, to: body.priority });
      row.priority = body.priority as Priority;
    }
    const start = body.startDate === undefined ? row.startDate : (body.startDate as string | null);
    const due = body.dueDate === undefined ? row.dueDate : (body.dueDate as string | null);
    if (start !== row.startDate || due !== row.dueDate) {
      this.log(id, 'dates_changed', { start, due });
      row.startDate = start;
      row.dueDate = due;
    }
    if (body.coverColor !== undefined) row.coverColor = body.coverColor as ColorId | null;
    if (body.completed !== undefined && body.completed !== !!row.completedAt) {
      row.completedAt = body.completed ? now : null;
      this.log(id, body.completed ? 'completed' : 'reopened');
    }
    if (body.archived !== undefined && body.archived !== !!row.archivedAt) {
      if (!body.archived) row.sortKey = this.cardKeyIn(row.columnId, null, false, id);
      row.archivedAt = body.archived ? now : null;
      this.log(id, body.archived ? 'archived' : 'restored');
    }
    if (Array.isArray(body.labelIds)) {
      const project = this.projectOfBoard(row.boardId);
      const known = new Set(this.labels.filter((l) => l.projectId === project.id).map((l) => l.id));
      const wanted = [...new Set(body.labelIds as string[])];
      if (wanted.some((l) => !known.has(l))) refuse(notFound('Label'));
      row.labelIds = wanted;
      this.log(id, 'labels_changed', { count: wanted.length });
    }
    row.updatedAt = now;
    return this.face(row);
  }

  private moveCard(id: string, body: Record<string, unknown>): Card {
    const row = this.cardRow(id);
    const column = this.column(String(body.columnId));
    const from = this.column(row.columnId);
    if (column.id !== row.columnId) this.checkWip(column, id);
    const lane = this.laneIn(column.boardId, body.swimlaneId);
    row.sortKey = this.cardKeyIn(
      column.id,
      (body.beforeId as string | null | undefined) ?? null,
      false,
      id,
    );
    if (column.boardId !== row.boardId) {
      const source = this.projectOfBoard(row.boardId);
      const target = this.projectOfBoard(column.boardId);
      if (source.id !== target.id) {
        row.number = target.next++;
        row.labelIds = [];
      }
    }
    if (column.isDone && !from.isDone) row.completedAt ??= this.now();
    if (!column.isDone && from.isDone) row.completedAt = null;
    row.boardId = column.boardId;
    row.columnId = column.id;
    row.swimlaneId = lane;
    row.updatedAt = this.now();
    if (column.id !== from.id) this.log(id, 'moved', { from: from.name, to: column.name });
    return this.face(row);
  }

  private duplicateCard(id: string): Card {
    const row = this.cardRow(id);
    this.checkWip(this.column(row.columnId));
    const siblings = this.cards
      .filter((c) => c.columnId === row.columnId && !c.archivedAt)
      .sort(bySortKey);
    const after = siblings[siblings.findIndex((c) => c.id === id) + 1];
    const now = this.now();
    const copy: CardRow = {
      ...row,
      id: this.id('card'),
      number: this.projectOfBoard(row.boardId).next++,
      title: `${row.title} (copy)`.slice(0, 300),
      labelIds: [...row.labelIds],
      sortKey: keysBetween(row.sortKey, after?.sortKey ?? null, 1)[0]!,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.cards.push(copy);
    for (const link of this.links.filter((l) => l.cardId === id))
      this.links.push({ ...link, cardId: copy.id, createdAt: now });
    for (const list of this.checklists.filter((l) => l.cardId === id)) {
      const listId = this.id('list');
      this.checklists.push({ ...list, id: listId, cardId: copy.id });
      for (const item of this.items.filter((i) => i.checklistId === list.id))
        this.items.push({ ...item, id: this.id('item'), checklistId: listId });
    }
    this.log(copy.id, 'duplicated', { from: row.number });
    return this.face(copy);
  }

  // Seeding

  /** Adds a card straight away (for seeding), with what it holds. */
  seedCard(boardId: string, card: SeedCard): CardRow {
    const columns = this.columns.filter((c) => c.boardId === boardId).sort(bySortKey);
    const column = columns[card.column]!;
    const project = this.projectOfBoard(boardId);
    const created = this.start - 10 * DAY + this.tick++ * MINUTE;
    const row: CardRow = {
      id: this.id('card'),
      boardId,
      columnId: column.id,
      swimlaneId: card.lane ?? null,
      number: project.next++,
      title: card.title,
      description: card.description ?? '',
      priority: card.priority ?? 'none',
      startDate: null,
      dueDate: card.dueDate ?? null,
      coverColor: null,
      labelIds: (card.labels ?? []).map(
        (name) => this.labels.find((l) => l.projectId === project.id && l.name === name)!.id,
      ),
      sortKey: place(
        this.cards.filter((c) => c.columnId === column.id && !c.archivedAt),
        null,
      ),
      completedAt: card.completed || column.isDone ? created : null,
      archivedAt: card.archived ? created : null,
      createdAt: created,
      updatedAt: created,
    };
    this.cards.push(row);
    this.activity.push({
      id: this.id('act'),
      cardId: row.id,
      type: 'created',
      payload: { column: column.name },
      author: this.author,
      createdAt: created,
    });
    for (const pageId of card.pages ?? [])
      this.links.push({ cardId: row.id, pageId, createdAt: created });
    if (card.checklist) {
      const listId = this.id('list');
      this.checklists.push({ id: listId, cardId: row.id, title: 'Checklist', sortKey: 'a0' });
      const keys = keysBetween(null, null, card.checklist.length);
      card.checklist.forEach(([text, done], i) =>
        this.items.push({
          id: this.id('item'),
          checklistId: listId,
          text,
          done,
          sortKey: keys[i]!,
        }),
      );
    }
    for (const body of card.comments ?? []) {
      this.comments.push({
        id: this.id('comment'),
        cardId: row.id,
        userId: 'u-sam',
        author: 'Sam Lake',
        body,
        createdAt: created + MINUTE,
        editedAt: null,
      });
    }
    return row;
  }

  seedProject(id: string, name: string, key: string, color: ColorId, icon: Project['icon']) {
    const project: ProjectRow = {
      id,
      name,
      key,
      color,
      icon,
      sortKey: place(this.projects, null),
      archivedAt: null,
      createdAt: this.start - 60 * DAY,
      updatedAt: this.start - 60 * DAY,
      next: 1,
    };
    this.projects.push(project);
    return project;
  }

  seedLabel(projectId: string, name: string, color: ColorId) {
    const label = { id: this.id('label'), projectId, name, color, createdAt: this.tick++ };
    this.labels.push(label);
    return label;
  }

  /** A board with `count` cards spread over five columns (for the speed test). */
  seedLargeBoard(count: number): string {
    const project = this.seedProject('big', 'Big project', 'BIG', 'violet', 'rocket');
    const board = this.createBoard(project.id, 'Everything', 'extended', 'big-board');
    const columns = this.columns.filter((c) => c.boardId === board.id).sort(bySortKey);
    const keysByColumn = columns.map(() => keysBetween(null, null, Math.ceil(count / 5)));
    const priorities: Priority[] = ['none', 'low', 'medium', 'high', 'urgent'];
    for (let i = 0; i < count; i++) {
      const c = i % columns.length;
      const now = this.start - DAY;
      this.cards.push({
        id: `big-${i}`,
        boardId: board.id,
        columnId: columns[c]!.id,
        swimlaneId: null,
        number: project.next++,
        title: `Task ${i + 1}: tidy up the ${['header', 'footer', 'sidebar', 'forms', 'tables'][i % 5]}`,
        description: '',
        priority: priorities[i % 5]!,
        startDate: null,
        dueDate: null,
        coverColor: null,
        labelIds: [],
        sortKey: keysByColumn[c]![Math.floor(i / columns.length)]!,
        completedAt: columns[c]!.isDone ? now : null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
    return board.id;
  }

  /** Like the old placeholder boards: two projects, one board with cards. */
  private seedDemo() {
    const web = this.seedProject('web', 'Website', 'WEB', 'cyan', 'code');
    const garden = this.seedProject('garden-app', 'Garden app', 'GRD', 'green', 'leaf');
    for (const [name, color] of [
      ['Design', 'violet'],
      ['Copy', 'amber'],
      ['Bug', 'coral'],
    ] as const) {
      this.seedLabel(web.id, name, color);
    }
    this.createBoard(web.id, 'Website relaunch', 'basic', 'relaunch');
    this.createBoard(web.id, 'Content calendar', 'basic', 'content');
    this.createBoard(garden.id, 'Sprint board', 'basic', 'sprint');
    const seed: SeedCard[] = [
      {
        title: 'Hero section copy',
        column: 0,
        labels: ['Copy'],
        priority: 'high',
        dueDate: '2026-10-02',
        pages: ['q4'],
        description: 'Short and **concrete**: what Memora does in one line.',
        checklist: [
          ['First draft', true],
          ['Review with design', false],
        ],
        comments: ['Keep it under ten words.'],
      },
      { title: 'Pricing page layout', column: 0, labels: ['Design'], priority: 'medium' },
      { title: 'Broken link in the footer', column: 0, labels: ['Bug'], dueDate: '2026-09-25' },
      { title: 'New navigation', column: 1, labels: ['Design'], priority: 'urgent' },
      { title: 'Launch announcement', column: 1, labels: ['Copy'], pages: ['launch'] },
      { title: 'Pick the fonts', column: 2 },
      { title: 'Old landing page', column: 0, archived: true },
    ];
    for (const card of seed) this.seedCard('relaunch', card);
    this.seedCard('sprint', { title: 'Watering schedule', column: 0 });
  }
}
