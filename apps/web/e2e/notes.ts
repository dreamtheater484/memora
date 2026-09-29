import {
  keysBetween,
  pickColor,
  placeKeys,
  richToText,
  snippetOf,
  type ColorId,
  type Notebook,
  type PageMeta,
  type PageType,
  type Section,
  type SectionGroup,
  type Settings,
  type TrashItem,
  type Tree,
  type TreeChanges,
  type VersionReason,
} from '@memora/shared';
import {
  buildIndex,
  mergeChanges,
  planGroupMove,
  planNotebookMove,
  planPagesMove,
  planSectionMove,
  removeItems,
} from '../src/notes/model';

/** A rich page's content: one paragraph per blank-line-separated part of `text`. */
export function richDoc(text?: string): string {
  if (!text) return '';
  return JSON.stringify({
    type: 'doc',
    content: text.split('\n\n').map((part) => ({
      type: 'paragraph',
      content: [{ type: 'text', text: part }],
    })),
  });
}

const snippetFor = (type: PageType, content: string) =>
  snippetOf(type === 'markdown' ? content : richToText(content));

/*
 * The notes part of the fake server: a seeded tree in memory, changed the way the real
 * server changes it (the web app's own planners place moved items), so flows like
 * "create, rename, delete, undo" work end to end.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface SeedPage {
  id: string;
  title: string;
  type?: PageType;
  text?: string;
  ago: number;
  children?: SeedPage[];
}

interface Reply {
  status?: number;
  json?: unknown;
}

const LISTS = {
  notebook: 'notebooks',
  group: 'groups',
  section: 'sections',
  page: 'pages',
} as const;

const notFound: Reply = {
  status: 404,
  json: { error: { code: 'not_found', message: 'Not found.' } },
};

/** A version the fake server kept: a conflict copy, what a change replaced, or a snapshot. */
export interface KeptVersion {
  id: string;
  pageId: string;
  content: string;
  reason: VersionReason;
  name: string | null;
  type: PageType;
  revision: number;
  createdAt: number;
}

/** A deleted item in the fake recycle bin, with what went with it. */
interface Trashed {
  item: TrashItem;
  name: string;
  location: string[];
  deletedAt: number;
  rows: Omit<Tree, 'inboxId'>;
}

export class FakeNotes {
  tree: Tree;
  settings: Settings;
  readonly content = new Map<string, string>();
  readonly versions: KeptVersion[] = [];
  /** Every content change, with the (real) time it happened. */
  private readonly history: { at: number; id: string; before: string; after: string }[] = [];
  /** Told about every content change, with the device that made it (null: elsewhere). */
  onChange: ((page: PageMeta, origin: string | null) => void) | null = null;
  /** The recycle bin, newest last. */
  readonly trash: Trashed[] = [];
  private nextId = 1;
  private nextVersion = 1;

  constructor(
    private readonly now: number,
    seed: 'demo' | 'empty' = 'demo',
  ) {
    this.tree = { inboxId: 'inbox', notebooks: [], groups: [], sections: [], pages: [] };
    this.settings = { ui: {}, editor: {} };
    this.tree.sections.push(this.section('inbox', 'Inbox', 'slate', null, null, 'a0'));
    if (seed === 'demo') this.seedDemo();
  }

  /** Adds `count` pages to a section, for speed tests. */
  addPages(sectionId: string, count: number) {
    const keys = keysBetween(null, null, count);
    for (let i = 0; i < count; i += 1) {
      const id = `bulk-${i}`;
      const text = `Note number ${i + 1}: a few words so every row has a snippet to show.`;
      this.content.set(id, text);
      this.tree.pages.push(
        this.meta(id, sectionId, null, `Note ${i + 1}`, 'markdown', keys[i]!, i * MINUTE, text),
      );
    }
  }

  respond(
    method: string,
    path: string,
    body: Record<string, unknown>,
    origin: string | null = null,
  ): Reply | null {
    const route = `${method} ${path.replace(/^\/api\/v1/, '')}`;
    const [, kind, id, action] = path.replace(/^\/api\/v1/, '').split('/');
    if (route === 'GET /tree') return { json: this.tree };
    if (route === 'GET /settings') return { json: this.settings };
    if (route === 'PATCH /settings') {
      const ui = (body.ui ?? {}) as Settings['ui'];
      const editor = (body.editor ?? {}) as Settings['editor'];
      const lastPages = { ...this.settings.ui.lastPages, ...ui.lastPages };
      this.settings = {
        ui: { ...this.settings.ui, ...ui, lastPages },
        editor: { ...this.settings.editor, ...editor },
      };
      return { json: this.settings };
    }
    if (route === 'POST /pages/move') return this.movePages(body);
    if (route === 'POST /pages/delete') {
      return this.remove((body.ids as string[]).map((pageId) => ({ type: 'page', id: pageId })));
    }
    if (route === 'POST /trash/restore') return this.restore(body.items as TrashItem[]);
    if (route === 'GET /trash') return this.trashList();
    if (route === 'POST /trash/restore-to') return this.restoreTo(body);
    if (route === 'POST /trash/delete') return this.deleteForever(body.items as TrashItem[]);
    if (route === 'POST /trash/empty') {
      const removed = this.trash.splice(0).length;
      return { json: { removed } };
    }
    const versionRoute = path.match(/\/pages\/([^/]+)\/versions\/([^/]+)(?:\/(restore|copy))?$/);
    if (versionRoute) {
      const [, pageId, versionId, verb] = versionRoute;
      return this.versionAction(method, pageId!, versionId!, verb, body);
    }
    if (route === 'POST /notebooks') return this.createNotebook(body);
    if (route === 'POST /groups') return this.createGroup(body);
    if (route === 'POST /sections') return this.createSection(body);
    if (route === 'POST /pages') return this.createPage(body);
    if (!id) return null;
    const type = (
      { notebooks: 'notebook', groups: 'group', sections: 'section', pages: 'page' } as const
    )[kind as 'notebooks' | 'groups' | 'sections' | 'pages'];
    if (!type) return null;
    if (method === 'GET' && type === 'page' && !action) return this.getPage(id);
    if (method === 'PUT' && type === 'page' && action === 'content') {
      return this.saveContent(id, body, origin);
    }
    if (method === 'GET' && type === 'page' && action === 'versions') return this.listVersions(id);
    if (method === 'POST' && type === 'page' && action === 'versions') {
      return this.keepVersion(id, body);
    }
    if (method === 'POST' && type === 'page' && action === 'convert') return this.convert(id, body);
    if (method === 'PATCH') return this.update(type, id, body);
    if (method === 'DELETE') return this.remove([{ type, id }]);
    if (method === 'POST' && action === 'move') return this.move(type, id, body);
    return null;
  }

  // Reading

  private getPage(id: string): Reply {
    const meta = this.tree.pages.find((p) => p.id === id);
    if (!meta) return notFound;
    return { json: { ...meta, content: this.content.get(id) ?? '' } };
  }

  // Content

  /** Changes a page's text as a save does: a new revision (another device, when `origin` is null). */
  edit(id: string, content: string, origin: string | null = null): PageMeta {
    const page = this.tree.pages.find((p) => p.id === id);
    if (!page) throw new Error(`No page ${id}`);
    this.history.push({ at: Date.now(), id, before: this.content.get(id) ?? '', after: content });
    this.content.set(id, content);
    const next: PageMeta = {
      ...page,
      revision: page.revision + 1,
      snippet: snippetFor(page.type, content),
      updatedAt: this.now,
    };
    this.apply({ pages: [next] });
    this.onChange?.(next, origin);
    return next;
  }

  /** The page's text as it was at `at` (a `Date.now()` time). */
  contentAt(id: string, at: number): string {
    const changes = this.history.filter((h) => h.id === id);
    const last = changes.findLast((h) => h.at <= at);
    return last ? last.after : (changes[0]?.before ?? this.content.get(id) ?? '');
  }

  private saveContent(id: string, body: Record<string, unknown>, origin: string | null): Reply {
    const page = this.tree.pages.find((p) => p.id === id);
    if (!page) return notFound;
    const current = this.content.get(id) ?? '';
    const content = String(body.content);
    if (content === current) return { json: { revision: page.revision, pages: [page] } };
    if (body.baseRevision !== page.revision) {
      return {
        status: 409,
        json: {
          error: {
            code: 'revision_conflict',
            message: 'This page was changed elsewhere.',
            details: { revision: page.revision, content: current, type: page.type },
          },
        },
      };
    }
    if (body.resolving) this.keep(id, current, 'conflict');
    const saved = this.edit(id, content, origin);
    return { json: { revision: saved.revision, pages: [saved] } };
  }

  private convert(id: string, body: Record<string, unknown>): Reply {
    const page = this.tree.pages.find((p) => p.id === id);
    if (!page) return notFound;
    if (body.baseRevision !== page.revision) {
      return {
        status: 409,
        json: { error: { code: 'revision_conflict', message: 'This page was changed elsewhere.' } },
      };
    }
    this.keep(id, this.content.get(id) ?? '', 'conversion');
    const type = body.type as PageType;
    const content = String(body.content);
    this.content.set(id, content);
    const next: PageMeta = {
      ...page,
      type,
      revision: page.revision + 1,
      snippet: snippetFor(type, content),
      updatedAt: this.now,
    };
    this.apply({ pages: [next] });
    return { json: { revision: next.revision, pages: [next] } };
  }

  /** Keeps a version of a page, `ago` before now (the fixed now of the tests). */
  keep(
    pageId: string,
    content: string,
    reason: VersionReason,
    { name = null, ago = 0 }: { name?: string | null; ago?: number } = {},
  ): KeptVersion {
    const page = this.tree.pages.find((p) => p.id === pageId);
    const version: KeptVersion = {
      id: `version-${this.nextVersion++}`,
      pageId,
      content,
      reason,
      name,
      type: page?.type ?? 'markdown',
      revision: page?.revision ?? 1,
      createdAt: this.now - ago,
    };
    this.versions.push(version);
    return version;
  }

  private versionMeta({ content, ...version }: KeptVersion) {
    return { ...version, size: content.length, deviceLabel: 'Chrome on Linux' };
  }

  private listVersions(pageId: string): Reply {
    if (!this.tree.pages.some((p) => p.id === pageId)) return notFound;
    const list = this.versions
      .filter((v) => v.pageId === pageId)
      .sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id, 'en', { numeric: true }),
      );
    return { json: list.map((v) => this.versionMeta(v)) };
  }

  private keepVersion(id: string, body: Record<string, unknown>): Reply {
    if (!this.tree.pages.some((p) => p.id === id)) return notFound;
    const reason = String(body.reason) as VersionReason;
    const name = typeof body.name === 'string' ? body.name : null;
    const content = reason === 'conflict' ? String(body.content) : (this.content.get(id) ?? '');
    const last = this.versions.findLast((v) => v.pageId === id);
    // The page as it is is already kept: an unnamed snapshot adds nothing.
    if (reason !== 'conflict' && !name && last?.content === content) {
      return { json: { version: null } };
    }
    const version = this.keep(id, content, reason, { name });
    return { status: 201, json: { version: this.versionMeta(version) } };
  }

  private versionAction(
    method: string,
    pageId: string,
    versionId: string,
    verb: string | undefined,
    body: Record<string, unknown>,
  ): Reply | null {
    const page = this.tree.pages.find((p) => p.id === pageId);
    const version = this.versions.find((v) => v.id === versionId && v.pageId === pageId);
    if (!page || !version) return notFound;
    if (method === 'GET' && !verb) {
      return {
        json: { ...this.versionMeta(version), title: page.title, content: version.content },
      };
    }
    if (method === 'PATCH' && !verb) {
      version.name = (body.name as string | null) ?? null;
      return { json: this.versionMeta(version) };
    }
    if (method === 'POST' && verb === 'restore') {
      this.keep(pageId, this.content.get(pageId) ?? '', 'restore');
      const saved = this.edit(pageId, version.content);
      return { json: { revision: saved.revision, pages: [saved] } };
    }
    if (method === 'POST' && verb === 'copy') {
      const copy = this.createPage({
        sectionId: page.sectionId,
        title: `${page.title} (2026-09-29 16:00)`,
        type: version.type,
        content: version.content,
      });
      return { status: 201, json: copy.json };
    }
    return null;
  }

  // Creating

  private id(prefix: string) {
    return `${prefix}-new-${this.nextId++}`;
  }

  private createNotebook(body: Record<string, unknown>): Reply {
    const [sortKey] = placeKeys([...this.tree.notebooks], null)!;
    const notebook: Notebook = {
      id: this.id('nb'),
      name: String(body.name),
      color: body.color as ColorId,
      icon: (body.icon as Notebook['icon']) ?? 'notebook',
      sortKey: sortKey!,
      createdAt: this.now,
      updatedAt: this.now,
    };
    const first = this.section(
      this.id('sec'),
      'New section',
      notebook.color,
      notebook.id,
      null,
      'a0',
    );
    return this.apply({ notebooks: [notebook], sections: [first] });
  }

  private createGroup(body: Record<string, unknown>): Reply {
    const notebookId = String(body.notebookId);
    const parentGroupId = (body.parentGroupId as string | null) ?? null;
    const siblings = buildIndex(this.tree).groupsIn(notebookId, parentGroupId);
    const [sortKey] = placeKeys(siblings, null)!;
    const group: SectionGroup = {
      id: this.id('grp'),
      notebookId,
      parentGroupId,
      name: String(body.name),
      sortKey: sortKey!,
      createdAt: this.now,
      updatedAt: this.now,
    };
    const used = this.tree.sections.filter((s) => s.notebookId === notebookId).map((s) => s.color);
    const first = this.section(
      this.id('sec'),
      'New section',
      pickColor(used),
      notebookId,
      group.id,
      'a0',
    );
    return this.apply({ groups: [group], sections: [first] });
  }

  private createSection(body: Record<string, unknown>): Reply {
    const notebookId = String(body.notebookId);
    const groupId = (body.groupId as string | null) ?? null;
    const [sortKey] = placeKeys(buildIndex(this.tree).sectionsIn(notebookId, groupId), null)!;
    const section = this.section(
      this.id('sec'),
      String(body.name),
      body.color as ColorId,
      notebookId,
      groupId,
      sortKey!,
    );
    return this.apply({ sections: [section] });
  }

  private createPage(body: Record<string, unknown>): Reply {
    const sectionId = String(body.sectionId);
    const parentPageId = (body.parentPageId as string | null) ?? null;
    const siblings = buildIndex(this.tree)
      .pagesOf(sectionId)
      .map((r) => r.page)
      .filter((p) => p.parentPageId === parentPageId);
    const [sortKey] = placeKeys(siblings, null)!;
    // Made by the browser; one created offline may be sent again after a lost answer.
    const given = typeof body.id === 'string' ? body.id : null;
    const existing = given && this.tree.pages.find((p) => p.id === given);
    if (existing) return { json: { pages: [existing] } };
    const id = given ?? this.id('page');
    const text = String(body.content ?? '');
    this.content.set(id, text);
    const page = this.meta(
      id,
      sectionId,
      parentPageId,
      String(body.title ?? '').trim(),
      (body.type as PageType) ?? 'markdown',
      sortKey!,
      0,
      text,
    );
    return this.apply({ pages: [page] });
  }

  // Changing

  private update(type: TrashItem['type'], id: string, body: Record<string, unknown>): Reply {
    const { content, ...fields } = body;
    if (typeof fields.title === 'string') fields.title = fields.title.trim();
    if (typeof content === 'string') this.content.set(id, content);
    const list = LISTS[type];
    const row = (this.tree[list] as { id: string }[]).find((x) => x.id === id);
    if (!row) return notFound;
    const next: Record<string, unknown> = { ...row, ...fields, updatedAt: this.now };
    if (type === 'page' && next.type === 'markdown')
      next.snippet = snippetOf(this.content.get(id) ?? '');
    return this.apply({ [list]: [next] });
  }

  private move(type: TrashItem['type'], id: string, body: Record<string, unknown>): Reply {
    const index = buildIndex(this.tree);
    const plan =
      type === 'notebook'
        ? planNotebookMove(index, id, (body.beforeId as string | null) ?? null)
        : type === 'section'
          ? planSectionMove(index, id, body as never)
          : type === 'group'
            ? planGroupMove(index, id, body as never)
            : null;
    return plan ? this.apply(plan) : notFound;
  }

  private movePages(body: Record<string, unknown>): Reply {
    const { ids, ...to } = body as {
      ids: string[];
      sectionId: string;
      parentPageId: string | null;
      beforeId: string | null;
    };
    const plan = planPagesMove(buildIndex(this.tree), ids, to);
    return plan ? this.apply(plan) : notFound;
  }

  // Deleting and restoring

  private remove(items: TrashItem[]): Reply {
    for (const item of items) {
      const before = this.tree;
      const index = buildIndex(before);
      const list = before[LISTS[item.type]] as { id: string; name?: string; title?: string }[];
      const row = list.find((x) => x.id === item.id);
      if (!row) continue;
      this.tree = removeItems(before, [item]);
      const gone = <T extends { id: string }>(all: T[], kept: T[]) => {
        const ids = new Set(kept.map((x) => x.id));
        return all.filter((x) => !ids.has(x.id));
      };
      this.trash.push({
        item,
        name: row.name ?? row.title ?? '',
        location: this.locationOf(index, item),
        deletedAt: this.now,
        rows: {
          notebooks: gone(before.notebooks, this.tree.notebooks),
          groups: gone(before.groups, this.tree.groups),
          sections: gone(before.sections, this.tree.sections),
          pages: gone(before.pages, this.tree.pages),
        },
      });
    }
    return { json: { deleted: items } };
  }

  private locationOf(index: ReturnType<typeof buildIndex>, item: TrashItem): string[] {
    if (item.type === 'notebook') return [];
    if (item.type === 'page') {
      const page = index.page.get(item.id);
      const path = page ? index.pathOf(page.sectionId) : null;
      if (!path) return [];
      return [
        ...(path.notebook ? [path.notebook.name] : []),
        ...path.groups.map((g) => g.name),
        path.section.name,
      ];
    }
    const notebookId =
      item.type === 'section'
        ? index.section.get(item.id)?.notebookId
        : index.group.get(item.id)?.notebookId;
    const notebook = notebookId ? index.notebook.get(notebookId) : undefined;
    return notebook ? [notebook.name] : [];
  }

  /** Whether the item's place is still there. */
  private restorable({ item, rows }: Trashed): boolean {
    const has = (list: { id: string }[], id: string | null) =>
      id === null || list.some((x) => x.id === id);
    if (item.type === 'notebook') return true;
    if (item.type === 'page') {
      const page = rows.pages.find((p) => p.id === item.id)!;
      return has(this.tree.sections, page.sectionId);
    }
    if (item.type === 'section') {
      const section = rows.sections.find((x) => x.id === item.id)!;
      return has(this.tree.notebooks, section.notebookId) && has(this.tree.groups, section.groupId);
    }
    const group = rows.groups.find((g) => g.id === item.id)!;
    return has(this.tree.notebooks, group.notebookId) && has(this.tree.groups, group.parentGroupId);
  }

  private trashList(): Reply {
    const entries = [...this.trash].reverse().map((t) => ({
      type: t.item.type,
      id: t.item.id,
      name: t.name,
      location: t.location,
      pages: t.rows.pages.length,
      deletedAt: t.deletedAt,
      purgeAt: t.deletedAt + 30 * DAY,
      restorable: this.restorable(t),
    }));
    return { json: { entries, days: 30 } };
  }

  private take(items: TrashItem[]): Trashed[] | null {
    const found = items.map((i) => this.trash.find((t) => t.item.id === i.id));
    if (found.some((t) => !t)) return null;
    for (const t of found) this.trash.splice(this.trash.indexOf(t!), 1);
    return found as Trashed[];
  }

  private restore(items: TrashItem[]): Reply {
    const all = items.map((i) => this.trash.find((t) => t.item.id === i.id));
    if (all.some((t) => !t)) return notFound;
    if (all.some((t) => !this.restorable(t!))) {
      return {
        status: 409,
        json: {
          error: { code: 'invalid_move', message: 'Its place is gone: restore it to another.' },
        },
      };
    }
    const changes: TreeChanges = { notebooks: [], groups: [], sections: [], pages: [] };
    for (const t of this.take(items)!) {
      changes.notebooks!.push(...t.rows.notebooks);
      changes.groups!.push(...t.rows.groups);
      changes.sections!.push(...t.rows.sections);
      changes.pages!.push(...t.rows.pages);
    }
    return this.apply(changes);
  }

  private restoreTo(body: Record<string, unknown>): Reply {
    const item = body.item as TrashItem;
    const to = body.to as { notebookId?: string; groupId?: string | null; sectionId?: string };
    const [t] = this.take([item]) ?? [];
    if (!t) return notFound;
    const { rows } = t;
    if (item.type === 'page') {
      for (const p of rows.pages) {
        p.sectionId = to.sectionId!;
        if (p.id === item.id) p.parentPageId = null;
      }
    } else {
      for (const s of rows.sections) s.notebookId = to.notebookId!;
      for (const g of rows.groups) g.notebookId = to.notebookId!;
      const root =
        item.type === 'section'
          ? rows.sections.find((x) => x.id === item.id)
          : rows.groups.find((x) => x.id === item.id);
      if (root && 'groupId' in root) root.groupId = to.groupId ?? null;
      if (root && 'parentGroupId' in root) root.parentGroupId = to.groupId ?? null;
    }
    return this.apply(rows);
  }

  private deleteForever(items: TrashItem[]): Reply {
    const gone = this.take(items);
    if (!gone) return notFound;
    return { json: { removed: gone.reduce((n, t) => n + t.rows.pages.length + 1, 0) } };
  }

  private apply(changes: TreeChanges): Reply {
    this.tree = mergeChanges(this.tree, changes);
    return { json: changes };
  }

  // Seeding

  private section(
    id: string,
    name: string,
    color: ColorId,
    notebookId: string | null,
    groupId: string | null,
    sortKey: string,
  ): Section {
    return {
      id,
      name,
      color,
      notebookId,
      groupId,
      sortKey,
      isInbox: notebookId === null,
      createdAt: this.now - 60 * DAY,
      updatedAt: this.now - 60 * DAY,
    };
  }

  private meta(
    id: string,
    sectionId: string,
    parentPageId: string | null,
    title: string,
    type: PageType,
    sortKey: string,
    ago: number,
    text: string,
  ): PageMeta {
    return {
      id,
      sectionId,
      parentPageId,
      title,
      type,
      sortKey,
      snippet: snippetFor(type, text),
      revision: 1,
      createdAt: this.now - ago - 7 * DAY,
      updatedAt: this.now - ago,
    };
  }

  private seedPages(sectionId: string, pages: SeedPage[], parentPageId: string | null = null) {
    const keys = keysBetween(null, null, pages.length);
    pages.forEach((p, i) => {
      const type = p.type ?? 'markdown';
      const text = type === 'markdown' ? (p.text ?? '') : richDoc(p.text);
      this.content.set(p.id, text);
      this.tree.pages.push(
        this.meta(p.id, sectionId, parentPageId, p.title, type, keys[i]!, p.ago, text),
      );
      if (p.children) this.seedPages(sectionId, p.children, p.id);
    });
  }

  private seedDemo() {
    const notebook = (id: string, name: string, color: ColorId, icon: Notebook['icon']) => ({
      id,
      name,
      color,
      icon,
      createdAt: this.now - 90 * DAY,
      updatedAt: this.now - 90 * DAY,
    });
    const nbKeys = keysBetween(null, null, 3);
    this.tree.notebooks = [
      { ...notebook('work', 'Work', 'indigo', 'briefcase'), sortKey: nbKeys[0]! },
      { ...notebook('personal', 'Personal', 'green', 'house'), sortKey: nbKeys[1]! },
      { ...notebook('side', 'Side projects', 'magenta', 'lightbulb'), sortKey: nbKeys[2]! },
    ];
    this.tree.groups = [
      {
        id: 'admin',
        notebookId: 'work',
        parentGroupId: null,
        name: 'Admin',
        sortKey: 'a0',
        createdAt: this.now - 60 * DAY,
        updatedAt: this.now - 60 * DAY,
      },
    ];
    const sections: [string, string, ColorId, string, string | null][] = [
      ['roadmap', 'Roadmap', 'blue', 'work', null],
      ['research', 'Research', 'teal', 'work', null],
      ['meetings', 'Meetings', 'amber', 'work', null],
      ['team', 'Team', 'violet', 'work', 'admin'],
      ['archive', 'Archive', 'slate', 'work', 'admin'],
      ['travel', 'Travel', 'cyan', 'personal', null],
      ['recipes', 'Recipes', 'orange', 'personal', null],
      ['reading', 'Reading', 'coral', 'personal', null],
      ['garden', 'Garden', 'lime', 'side', null],
      ['ideas', 'Ideas', 'magenta', 'side', null],
    ];
    const byPlace = new Map<string, number>();
    for (const [id, name, color, nb, group] of sections) {
      const place = `${nb}|${group}`;
      const n = byPlace.get(place) ?? 0;
      byPlace.set(place, n + 1);
      this.tree.sections.push(this.section(id, name, color, nb, group, `a${n}`));
    }

    this.seedPages('roadmap', [
      {
        id: 'q4',
        title: 'Q4 roadmap',
        text: 'Ship the offline outbox first, then polish search.\n\nBoards follow once sync is solid.',
        ago: 2 * MINUTE,
        children: [
          {
            id: 'drn',
            title: 'Design review notes',
            text: 'Offline badge stays until the outbox is empty.',
            ago: DAY,
          },
          {
            id: 'launch',
            title: 'Launch checklist',
            text: 'Backups, smoke test, announcement draft.',
            ago: 3 * DAY,
          },
        ],
      },
      { id: 'pricing', title: 'Pricing experiments', type: 'rich', ago: 7 * DAY },
      {
        id: 'openq',
        title: 'Open questions',
        text: 'Do boards need swimlanes in the first version?',
        ago: 11 * DAY,
      },
      { id: 'retro', title: 'Retro — September', type: 'rich', ago: 17 * DAY },
    ]);
    this.seedPages('research', [
      {
        id: 'comp',
        title: 'Competitor notes',
        type: 'rich',
        text: 'Three apps compared on sync, offline use and export.\n\nNone keeps tables lined up in their Markdown.',
        ago: 3 * HOUR,
      },
      {
        id: 'interview',
        title: 'Interview synthesis',
        text: '12 interviews, 4 themes. Top pain: trusting sync.',
        ago: 5 * DAY,
        children: [{ id: 'bench', title: 'Pricing benchmarks', type: 'rich', ago: 12 * DAY }],
      },
      {
        id: 'offline',
        title: 'Offline mode — spec',
        text: 'Edits go to the outbox and replay in order.',
        ago: 14 * DAY,
      },
    ]);
    this.seedPages('travel', [{ id: 'lisbon', title: 'Lisbon trip', type: 'rich', ago: 30 * DAY }]);
    this.seedPages('recipes', [
      {
        id: 'sourdough',
        title: 'Sourdough schedule',
        text: 'Feed at 8, bulk until 2, shape and cold proof.',
        ago: 39 * DAY,
      },
    ]);
    this.seedPages('inbox', [
      { id: 'plumber', title: 'Call the plumber', text: 'Ask about Tuesday morning.', ago: HOUR },
    ]);
    this.settings = {
      ui: {
        lastSectionId: 'roadmap',
        lastPages: { roadmap: 'q4', research: 'comp' },
        expanded: ['work'],
        pageListSide: 'right',
      },
      editor: {},
    };
  }
}
