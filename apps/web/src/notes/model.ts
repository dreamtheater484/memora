import {
  MAX_GROUP_DEPTH,
  MAX_PAGE_DEPTH,
  bySortKey,
  childrenByParent,
  depthOf,
  heightOf,
  isWithin,
  placeKeys,
  subtreeOf,
  type Notebook,
  type PageMeta,
  type Section,
  type SectionGroup,
  type Tag,
  type TrashItem,
  type Tree,
  type TreeChanges,
} from '@memora/shared';

/*
 * The web app's view of the notes tree: lookups and ordered lists built once per tree, and
 * pure functions that plan a change the way the server will make it, so the screen can show
 * it at once. The server's answer then replaces the planned rows.
 */

export interface PageRow {
  page: PageMeta;
  /** 1 for a top-level page. */
  depth: number;
  hasChildren: boolean;
}

export interface SectionPath {
  notebook: Notebook | null;
  /** Section groups from the outermost in. */
  groups: SectionGroup[];
  section: Section;
}

export interface NotesIndex {
  tree: Tree;
  notebooks: Notebook[];
  notebook: ReadonlyMap<string, Notebook>;
  group: ReadonlyMap<string, SectionGroup>;
  section: ReadonlyMap<string, Section>;
  page: ReadonlyMap<string, PageMeta>;
  /** Tags by id, and all of them by name. */
  tag: ReadonlyMap<string, Tag>;
  tags: Tag[];
  inbox: Section;
  /** Sections directly in a notebook (`groupId` null) or in a group, in order. */
  sectionsIn(notebookId: string, groupId: string | null): Section[];
  /** Groups directly in a notebook (`parentGroupId` null) or in a group, in order. */
  groupsIn(notebookId: string, parentGroupId: string | null): SectionGroup[];
  /** A section's pages in list order, subpages after their parent. */
  pagesOf(sectionId: string): PageRow[];
  /** Every section of a notebook in reading order: its own sections, then each group's. */
  allSectionsOf(notebookId: string, groupId?: string | null): Section[];
  pathOf(sectionId: string): SectionPath | null;
}

const key = (a: string | null, b: string | null) => `${a ?? ''}|${b ?? ''}`;

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  for (const list of map.values()) (list as { id: string; sortKey: string }[]).sort(bySortKey);
  return map;
}

export function buildIndex(tree: Tree): NotesIndex {
  const notebook = new Map(tree.notebooks.map((n) => [n.id, n]));
  const group = new Map(tree.groups.map((g) => [g.id, g]));
  const section = new Map(tree.sections.map((s) => [s.id, s]));
  const page = new Map(tree.pages.map((p) => [p.id, p]));
  const tags = [...(tree.tags ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  const tag = new Map(tags.map((t) => [t.id, t]));
  const sectionsBy = groupBy(tree.sections, (s) => key(s.notebookId, s.groupId));
  const groupsBy = groupBy(tree.groups, (g) => key(g.notebookId, g.parentGroupId));
  const pagesBy = groupBy(tree.pages, (p) => p.sectionId);
  const outlines = new Map<string, PageRow[]>();

  const index: NotesIndex = {
    tree,
    notebooks: [...tree.notebooks].sort(bySortKey),
    notebook,
    group,
    section,
    page,
    tag,
    tags,
    inbox: section.get(tree.inboxId)!,
    sectionsIn: (notebookId, groupId) => sectionsBy.get(key(notebookId, groupId)) ?? [],
    groupsIn: (notebookId, parentGroupId) => groupsBy.get(key(notebookId, parentGroupId)) ?? [],
    pagesOf(sectionId) {
      let rows = outlines.get(sectionId);
      if (!rows) {
        const children = childrenByParent(pagesBy.get(sectionId) ?? [], (p) => p.parentPageId);
        rows = [];
        const visit = (parent: string | null, depth: number) => {
          for (const p of children.get(parent) ?? []) {
            const hasChildren = (children.get(p.id)?.length ?? 0) > 0;
            rows!.push({ page: p, depth, hasChildren });
            visit(p.id, depth + 1);
          }
        };
        visit(null, 1);
        outlines.set(sectionId, rows);
      }
      return rows;
    },
    allSectionsOf(notebookId, groupId = null) {
      return [
        ...index.sectionsIn(notebookId, groupId),
        ...index
          .groupsIn(notebookId, groupId)
          .flatMap((g) => index.allSectionsOf(notebookId, g.id)),
      ];
    },
    pathOf(sectionId) {
      const s = section.get(sectionId);
      if (!s) return null;
      const groups: SectionGroup[] = [];
      for (let g = s.groupId ? group.get(s.groupId) : undefined; g;) {
        groups.unshift(g);
        g = g.parentGroupId ? group.get(g.parentGroupId) : undefined;
      }
      return {
        notebook: s.notebookId ? (notebook.get(s.notebookId) ?? null) : null,
        groups,
        section: s,
      };
    },
  };
  return index;
}

// Applying answers

const upsert = <T extends { id: string }>(list: readonly T[], changed?: readonly T[]): T[] => {
  if (!changed?.length) return list as T[];
  const byId = new Map(changed.map((c) => [c.id, c]));
  const next = list.map((item) => byId.get(item.id) ?? item);
  const known = new Set(list.map((item) => item.id));
  return [...next, ...changed.filter((c) => !known.has(c.id))];
};

/** Puts created and updated rows into the tree. */
export function mergeChanges(tree: Tree, changes: TreeChanges): Tree {
  return {
    ...tree,
    notebooks: upsert(tree.notebooks, changes.notebooks),
    groups: upsert(tree.groups, changes.groups),
    sections: upsert(tree.sections, changes.sections),
    pages: upsert(tree.pages, changes.pages),
    ...(changes.tags?.length ? { tags: upsert(tree.tags ?? [], changes.tags) } : {}),
  };
}

/** Takes deleted items out of the tree, with everything inside them. */
export function removeItems(tree: Tree, items: readonly TrashItem[]): Tree {
  const groups = new Set<string>();
  const sections = new Set<string>();
  const pages = new Set<string>();
  const notebooks = new Set(items.filter((i) => i.type === 'notebook').map((i) => i.id));
  for (const g of tree.groups) if (notebooks.has(g.notebookId)) groups.add(g.id);
  const groupChildren = childrenByParent(tree.groups, (g) => g.parentGroupId);
  for (const item of items.filter((i) => i.type === 'group')) {
    const root = tree.groups.find((g) => g.id === item.id);
    if (root) for (const g of subtreeOf(groupChildren, root)) groups.add(g.id);
  }
  for (const s of tree.sections) {
    const inNotebook = s.notebookId !== null && notebooks.has(s.notebookId);
    const inGroup = s.groupId !== null && groups.has(s.groupId);
    if (inNotebook || inGroup || items.some((i) => i.type === 'section' && i.id === s.id)) {
      sections.add(s.id);
    }
  }
  const pageChildren = childrenByParent(tree.pages, (p) => p.parentPageId);
  for (const p of tree.pages) if (sections.has(p.sectionId)) pages.add(p.id);
  for (const item of items.filter((i) => i.type === 'page')) {
    const root = tree.pages.find((p) => p.id === item.id);
    if (root) for (const p of subtreeOf(pageChildren, root)) pages.add(p.id);
  }
  return {
    ...tree,
    notebooks: tree.notebooks.filter((n) => !notebooks.has(n.id)),
    groups: tree.groups.filter((g) => !groups.has(g.id)),
    sections: tree.sections.filter((s) => !sections.has(s.id)),
    pages: tree.pages.filter((p) => !pages.has(p.id)),
  };
}

// Planning moves (the same rules and sort keys as the server)

/** Why a move can't happen, in words for a toast; null when it can. */
export type Verdict = string | null;

const pageParent = (p: PageMeta) => p.parentPageId;
const groupParent = (g: SectionGroup) => g.parentGroupId;

export function planNotebookMove(index: NotesIndex, id: string, beforeId: string | null) {
  const siblings = index.notebooks.filter((n) => n.id !== id);
  const [sortKey] = placeKeys(siblings, beforeId) ?? [];
  const nb = index.notebook.get(id);
  return nb && sortKey ? { notebooks: [{ ...nb, sortKey }] } : null;
}

export interface SectionPlace {
  notebookId: string;
  groupId: string | null;
  beforeId: string | null;
}

export function planSectionMove(index: NotesIndex, id: string, to: SectionPlace) {
  const section = index.section.get(id);
  if (!section || section.isInbox) return null;
  const siblings = index.sectionsIn(to.notebookId, to.groupId).filter((s) => s.id !== id);
  const [sortKey] = placeKeys(siblings, to.beforeId) ?? [];
  if (!sortKey) return null;
  return { sections: [{ ...section, notebookId: to.notebookId, groupId: to.groupId, sortKey }] };
}

export interface GroupPlace {
  notebookId: string;
  parentGroupId: string | null;
  beforeId: string | null;
}

export function checkGroupMove(index: NotesIndex, id: string, to: GroupPlace): Verdict {
  const group = index.group.get(id);
  if (!group) return 'That section group is gone.';
  if (to.parentGroupId && isWithin(index.group, to.parentGroupId, id, groupParent)) {
    return 'A section group can’t go inside itself.';
  }
  const children = childrenByParent(index.tree.groups, groupParent);
  const depth = depthOf(index.group, to.parentGroupId, groupParent) + heightOf(children, id);
  return depth > MAX_GROUP_DEPTH
    ? `Section groups go at most ${MAX_GROUP_DEPTH} levels deep.`
    : null;
}

export function planGroupMove(index: NotesIndex, id: string, to: GroupPlace): TreeChanges | null {
  const group = index.group.get(id);
  if (!group || checkGroupMove(index, id, to)) return null;
  const siblings = index.groupsIn(to.notebookId, to.parentGroupId).filter((g) => g.id !== id);
  const [sortKey] = placeKeys(siblings, to.beforeId) ?? [];
  if (!sortKey) return null;
  const moved = { ...group, notebookId: to.notebookId, parentGroupId: to.parentGroupId, sortKey };
  if (to.notebookId === group.notebookId) return { groups: [moved] };
  const below = subtreeOf(childrenByParent(index.tree.groups, groupParent), group).slice(1);
  const ids = new Set([id, ...below.map((g) => g.id)]);
  return {
    groups: [moved, ...below.map((g) => ({ ...g, notebookId: to.notebookId }))],
    sections: index.tree.sections
      .filter((s) => s.groupId !== null && ids.has(s.groupId))
      .map((s) => ({ ...s, notebookId: to.notebookId })),
  };
}

export interface PagePlace {
  sectionId: string;
  parentPageId: string | null;
  beforeId: string | null;
}

/** The selected pages that aren't inside another selected page, in the order given. */
export function topmostPages(index: NotesIndex, ids: readonly string[]): PageMeta[] {
  const selected = ids.map((id) => index.page.get(id)).filter((p): p is PageMeta => !!p);
  return selected.filter(
    (p) =>
      !selected.some(
        (o) => o.id !== p.id && isWithin(index.page, p.parentPageId, o.id, pageParent),
      ),
  );
}

export function checkPagePlace(
  index: NotesIndex,
  ids: readonly string[],
  to: PagePlace,
  moving: boolean,
): Verdict {
  const roots = topmostPages(index, ids);
  if (!roots.length) return 'Those pages are gone.';
  if (to.parentPageId !== null) {
    const parent = index.page.get(to.parentPageId);
    if (!parent || parent.sectionId !== to.sectionId) return 'That page is in another section.';
    if (moving && roots.some((r) => isWithin(index.page, to.parentPageId, r.id, pageParent))) {
      return 'A page can’t go inside itself.';
    }
  }
  if (moving && to.beforeId && roots.some((r) => r.id === to.beforeId)) {
    return 'A page can’t go before itself.';
  }
  const children = childrenByParent(index.tree.pages, pageParent);
  const parentDepth = depthOf(index.page, to.parentPageId, pageParent);
  return roots.some((r) => parentDepth + heightOf(children, r.id) > MAX_PAGE_DEPTH)
    ? `Pages go at most ${MAX_PAGE_DEPTH} levels deep.`
    : null;
}

export function planPagesMove(
  index: NotesIndex,
  ids: readonly string[],
  to: PagePlace,
): TreeChanges | null {
  if (checkPagePlace(index, ids, to, true)) return null;
  const roots = topmostPages(index, ids);
  const rootIds = new Set(roots.map((r) => r.id));
  const siblings = index
    .pagesOf(to.sectionId)
    .map((r) => r.page)
    .filter((p) => p.parentPageId === to.parentPageId && !rootIds.has(p.id));
  const keys = placeKeys(siblings, to.beforeId, roots.length);
  if (!keys) return null;
  const children = childrenByParent(index.tree.pages, pageParent);
  const pages: PageMeta[] = [];
  roots.forEach((root, i) => {
    pages.push({
      ...root,
      sectionId: to.sectionId,
      parentPageId: to.parentPageId,
      sortKey: keys[i]!,
    });
    for (const p of subtreeOf(children, root).slice(1))
      pages.push({ ...p, sectionId: to.sectionId });
  });
  return { pages };
}

/** Where a page goes one level in (under the page above it) or out (after its parent). */
export function indentPlace(index: NotesIndex, pageId: string): PagePlace | null {
  const page = index.page.get(pageId);
  if (!page) return null;
  const siblings = index
    .pagesOf(page.sectionId)
    .map((r) => r.page)
    .filter((p) => p.parentPageId === page.parentPageId);
  const above = siblings[siblings.findIndex((p) => p.id === pageId) - 1];
  if (!above) return null;
  return { sectionId: page.sectionId, parentPageId: above.id, beforeId: null };
}

export function outdentPlace(index: NotesIndex, pageId: string): PagePlace | null {
  const page = index.page.get(pageId);
  const parent = page?.parentPageId ? index.page.get(page.parentPageId) : undefined;
  if (!page || !parent) return null;
  const siblings = index
    .pagesOf(page.sectionId)
    .map((r) => r.page)
    .filter((p) => p.parentPageId === parent.parentPageId);
  const after = siblings[siblings.findIndex((p) => p.id === parent.id) + 1];
  return {
    sectionId: page.sectionId,
    parentPageId: parent.parentPageId,
    beforeId: after?.id ?? null,
  };
}

/** Where a page goes one place up or down among its siblings. */
export function shiftPlace(index: NotesIndex, pageId: string, by: -1 | 1): PagePlace | null {
  const page = index.page.get(pageId);
  if (!page) return null;
  const siblings = index
    .pagesOf(page.sectionId)
    .map((r) => r.page)
    .filter((p) => p.parentPageId === page.parentPageId);
  const at = siblings.findIndex((p) => p.id === pageId);
  const target = at + by;
  if (target < 0 || target >= siblings.length) return null;
  // Moving down means going before the sibling after next.
  const before = by === -1 ? siblings[target] : siblings[target + 1];
  return {
    sectionId: page.sectionId,
    parentPageId: page.parentPageId,
    beforeId: before?.id ?? null,
  };
}

/** Where a sibling-ordered item (notebook, section, group) goes one place up or down. */
export function shiftBefore<T extends { id: string }>(
  siblings: readonly T[],
  id: string,
  by: -1 | 1,
): { beforeId: string | null } | null {
  const at = siblings.findIndex((s) => s.id === id);
  const target = at + by;
  if (at < 0 || target < 0 || target >= siblings.length) return null;
  const before = by === -1 ? siblings[target] : siblings[target + 1];
  return { beforeId: before?.id ?? null };
}
