import { assetIdsIn, type ExportScope, type PageType } from '@memora/shared';
import type { SqliteDatabase } from '../db/client';
import { notFound } from '../errors';

/*
 * What an export contains (§9.10): the pages of a scope with the notebook, groups and sections
 * around them. Pages' text is read one page at a time while writing, so a large export never
 * holds every page in memory.
 */

export interface NotebookItem {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface GroupItem {
  id: string;
  notebookId: string;
  parentGroupId: string | null;
  name: string;
  sortKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface SectionItem {
  id: string;
  notebookId: string | null;
  groupId: string | null;
  name: string;
  color: string;
  sortKey: string;
  isInbox: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PageItem {
  id: string;
  sectionId: string;
  parentPageId: string | null;
  title: string;
  type: PageType;
  sortKey: string;
  viewMode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Collected {
  scope: { type: ExportScope; ids: string[] };
  notebooks: NotebookItem[];
  groups: GroupItem[];
  sections: SectionItem[];
  pages: PageItem[];
  /** Tag names by page. */
  tags: Map<string, string[]>;
  /** The tags used, with their colours. */
  tagList: { name: string; color: string | null }[];
}

const byKey = <T extends { sortKey: string; id: string }>(a: T, b: T) =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1;

export function collect(
  db: SqliteDatabase,
  owner: string,
  scope: ExportScope,
  id: string | undefined,
): Collected {
  const notebooks = db
    .prepare(
      `SELECT id, name, color, icon, sort_key AS sortKey, created_at AS createdAt, updated_at AS updatedAt
       FROM notebooks WHERE owner_id = ? AND deleted_at IS NULL`,
    )
    .all(owner) as NotebookItem[];
  const groups = db
    .prepare(
      `SELECT id, notebook_id AS notebookId, parent_group_id AS parentGroupId, name, sort_key AS sortKey,
              created_at AS createdAt, updated_at AS updatedAt
       FROM section_groups WHERE owner_id = ? AND deleted_at IS NULL`,
    )
    .all(owner) as GroupItem[];
  const sections = (
    db
      .prepare(
        `SELECT id, notebook_id AS notebookId, group_id AS groupId, name, color, sort_key AS sortKey,
                is_inbox AS isInbox, created_at AS createdAt, updated_at AS updatedAt
         FROM sections WHERE owner_id = ? AND deleted_at IS NULL`,
      )
      .all(owner) as (Omit<SectionItem, 'isInbox'> & { isInbox: number })[]
  ).map((s): SectionItem => ({ ...s, isInbox: !!s.isInbox }));
  const pages = db
    .prepare(
      `SELECT id, section_id AS sectionId, parent_page_id AS parentPageId, title, type, sort_key AS sortKey,
              view_mode AS viewMode, created_at AS createdAt, updated_at AS updatedAt
       FROM pages WHERE owner_id = ? AND deleted_at IS NULL`,
    )
    .all(owner) as PageItem[];

  let keep: {
    notebooks: Set<string>;
    groups: Set<string>;
    sections: Set<string>;
    pages: Set<string>;
  };
  const all = () => ({
    notebooks: new Set(notebooks.map((n) => n.id)),
    groups: new Set(groups.map((g) => g.id)),
    sections: new Set(sections.map((s) => s.id)),
    pages: new Set(pages.map((p) => p.id)),
  });
  const subtree = <T extends { id: string }>(
    items: T[],
    parentOf: (item: T) => string | null,
    root: string,
  ) => {
    const found = new Set([root]);
    for (let grew = true; grew;) {
      grew = false;
      for (const item of items) {
        const parent = parentOf(item);
        if (parent && found.has(parent) && !found.has(item.id)) {
          found.add(item.id);
          grew = true;
        }
      }
    }
    return found;
  };
  const pagesIn = (sectionIds: Set<string>) =>
    new Set(pages.filter((p) => sectionIds.has(p.sectionId)).map((p) => p.id));

  switch (scope) {
    case 'everything':
      keep = all();
      break;
    case 'notebook': {
      if (!notebooks.some((n) => n.id === id)) throw notFound('Notebook not found.');
      const s = new Set(sections.filter((x) => x.notebookId === id).map((x) => x.id));
      keep = {
        notebooks: new Set([id!]),
        groups: new Set(groups.filter((g) => g.notebookId === id).map((g) => g.id)),
        sections: s,
        pages: pagesIn(s),
      };
      break;
    }
    case 'group': {
      const group = groups.find((g) => g.id === id);
      if (!group) throw notFound('Section group not found.');
      const g = subtree(groups, (x) => x.parentGroupId, group.id);
      const s = new Set(sections.filter((x) => x.groupId && g.has(x.groupId)).map((x) => x.id));
      keep = { notebooks: new Set([group.notebookId]), groups: g, sections: s, pages: pagesIn(s) };
      break;
    }
    case 'section': {
      const section = sections.find((s) => s.id === id);
      if (!section) throw notFound('Section not found.');
      keep = {
        notebooks: new Set(section.notebookId ? [section.notebookId] : []),
        groups: new Set(),
        sections: new Set([section.id]),
        pages: pagesIn(new Set([section.id])),
      };
      break;
    }
    case 'page': {
      const page = pages.find((p) => p.id === id);
      if (!page) throw notFound('Page not found.');
      const section = sections.find((s) => s.id === page.sectionId)!;
      keep = {
        notebooks: new Set(section.notebookId ? [section.notebookId] : []),
        groups: new Set(),
        sections: new Set([section.id]),
        pages: subtree(pages, (p) => p.parentPageId, page.id),
      };
      break;
    }
  }

  const kept = pages.filter((p) => keep.pages.has(p.id)).sort(byKey);
  // A page whose parent isn't exported starts at the top of its section.
  const exported = new Set(kept.map((p) => p.id));
  for (const p of kept) if (p.parentPageId && !exported.has(p.parentPageId)) p.parentPageId = null;

  const tags = new Map<string, string[]>();
  const used = new Map<string, { name: string; color: string | null }>();
  const rows = db
    .prepare(
      `SELECT pt.page_id AS pageId, t.name, t.color FROM page_tags pt JOIN tags t ON t.id = pt.tag_id
       WHERE t.owner_id = ? ORDER BY t.name_key`,
    )
    .all(owner) as { pageId: string; name: string; color: string | null }[];
  for (const row of rows) {
    if (!exported.has(row.pageId)) continue;
    tags.set(row.pageId, [...(tags.get(row.pageId) ?? []), row.name]);
    used.set(row.name.toLowerCase(), { name: row.name, color: row.color });
  }

  return {
    scope: { type: scope, ids: id ? [id] : [] },
    notebooks: notebooks.filter((n) => keep.notebooks.has(n.id)).sort(byKey),
    groups: groups.filter((g) => keep.groups.has(g.id)).sort(byKey),
    sections: sections.filter((s) => keep.sections.has(s.id)).sort(byKey),
    pages: kept,
    tags,
    tagList: [...used.values()],
  };
}

/** A page's content, read when it is written. */
export function contentOf(db: SqliteDatabase, pageId: string): string {
  const row = db.prepare('SELECT content FROM pages WHERE id = ?').get(pageId) as
    { content: string } | undefined;
  return row?.content ?? '';
}

export interface AssetInfo {
  id: string;
  sha256: string;
  mime: string;
  name: string;
  size: number;
}

/** The files the pages refer to, that the user has. */
export function assetsOf(
  db: SqliteDatabase,
  owner: string,
  pageIds: readonly string[],
  /** Files used elsewhere (by cards). */
  more: readonly string[] = [],
): AssetInfo[] {
  const ids = new Set<string>(more.map((id) => id.toLowerCase()));
  for (const id of pageIds) {
    const content = contentOf(db, id);
    if (content.includes('asset:')) for (const asset of assetIdsIn(content)) ids.add(asset);
  }
  const read = db.prepare(
    `SELECT id, sha256, mime, original_name AS name, size FROM assets WHERE id = ? AND owner_id = ?`,
  );
  return [...ids]
    .map((id) => read.get(id, owner) as AssetInfo | undefined)
    .filter((a): a is AssetInfo => !!a);
}

/** A file's bytes. */
export function blobOf(db: SqliteDatabase, owner: string, sha256: string): Buffer {
  const row = db
    .prepare('SELECT data FROM asset_blobs WHERE owner_id = ? AND sha256 = ?')
    .get(owner, sha256) as { data: Buffer } | undefined;
  return row?.data ?? Buffer.alloc(0);
}

/** A file extension for a stored file's type. */
export function extensionOf(mime: string, name: string): string {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]?.toLowerCase();
  const known: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
  };
  return known[mime] ?? fromName ?? 'bin';
}
