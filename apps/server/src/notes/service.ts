import {
  INBOX_NAME,
  MAX_GROUP_DEPTH,
  MAX_PAGE_DEPTH,
  SNIPPET_LENGTH,
  bySortKey,
  childrenByParent,
  depthOf,
  heightOf,
  isWithin,
  markdownToText,
  pickColor,
  placeKeys,
  snippetOf,
  subtreeOf,
  uuidv7,
  type ColorId,
  type ContentConflict,
  type ContentSaved,
  type DeleteResponse,
  type Notebook,
  type NotebookIcon,
  type Page,
  type PageMeta,
  type PageVersionMeta,
  type Section,
  type SectionGroup,
  type TrashItem,
  type Tree,
  type TreeChanges,
  type createGroupSchema,
  type createNotebookSchema,
  type createPageSchema,
  type createSectionSchema,
  type createVersionSchema,
  type moveGroupSchema,
  type moveSectionSchema,
  type placePagesSchema,
  type saveContentSchema,
  type updateNotebookSchema,
  type updatePageSchema,
  type updateSectionSchema,
} from '@memora/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { SqliteDatabase } from '../db/client';
import {
  notebooks,
  pageVersions,
  pages,
  sectionGroups,
  sections,
  type NotebookRow,
  type PageRow,
  type PageVersionRow,
  type SectionGroupRow,
  type SectionRow,
} from '../db/schema';
import { ApiError, notFound } from '../errors';
import type { Orm } from '../repo';

/*
 * Notebooks, section groups, sections and pages (§7.2, §9.2).
 *
 * Owner-scoped like the repositories: every method takes the caller's id and every query filters
 * on `owner_id`, so another user's id is simply "not found". Changes run in one transaction and
 * answer with the rows they touched, which the web app merges into its copy of the tree.
 */

type In<S extends z.ZodType> = z.output<S>;

interface PageNode {
  id: string;
  sectionId: string;
  parentPageId: string | null;
  sortKey: string;
}

const pageParent = (p: PageNode) => p.parentPageId;
const groupParent = (g: SectionGroupRow) => g.parentGroupId;

const invalidMove = (message: string) => new ApiError(400, 'invalid_move', message);
const tooDeep = (message: string) => new ApiError(400, 'too_deep', message);
const inBin = (message: string) => new ApiError(409, 'conflict', message);

/** A save keeps the content it replaces when the page's last version is older than this (§9.7). */
const VERSION_INTERVAL_MS = 10 * 60_000;

const toNotebook = (r: NotebookRow): Notebook => ({
  id: r.id,
  name: r.name,
  color: r.color as ColorId,
  icon: r.icon as NotebookIcon,
  sortKey: r.sortKey,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toGroup = (r: SectionGroupRow): SectionGroup => ({
  id: r.id,
  notebookId: r.notebookId,
  parentGroupId: r.parentGroupId,
  name: r.name,
  sortKey: r.sortKey,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const toSection = (r: SectionRow): Section => ({
  id: r.id,
  notebookId: r.notebookId,
  groupId: r.groupId,
  name: r.name,
  color: r.color as ColorId,
  sortKey: r.sortKey,
  isInbox: r.isInbox,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Page list columns: a slice of the text is enough for the snippet. */
const pageMetaColumns = {
  id: pages.id,
  sectionId: pages.sectionId,
  parentPageId: pages.parentPageId,
  title: pages.title,
  type: pages.type,
  sortKey: pages.sortKey,
  revision: pages.revision,
  viewMode: pages.viewMode,
  createdAt: pages.createdAt,
  updatedAt: pages.updatedAt,
  text: sql<string>`substr(${pages.contentText}, 1, ${SNIPPET_LENGTH * 2})`,
};

const toPageMeta = ({ text, ...row }: Omit<PageMeta, 'snippet'> & { text: string }) =>
  ({
    id: row.id,
    sectionId: row.sectionId,
    parentPageId: row.parentPageId,
    title: row.title,
    type: row.type,
    sortKey: row.sortKey,
    snippet: snippetOf(text),
    revision: row.revision,
    viewMode: row.viewMode ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }) satisfies PageMeta;

const toVersionMeta = (r: PageVersionRow): PageVersionMeta => ({
  id: r.id,
  pageId: r.pageId,
  revision: r.revision,
  reason: r.reason,
  deviceLabel: r.deviceLabel,
  createdAt: r.createdAt,
});

const textOf = (type: PageRow['type'], content: string) =>
  type === 'markdown' ? markdownToText(content) : '';

/** Splits long id lists, well under SQLite's limit on bound parameters. */
const chunks = <T>(items: readonly T[], size = 500): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, i * size + size),
  );

export class NotesService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly orm: Orm,
    private readonly now: () => number,
  ) {}

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // Tree

  /** Everything the app needs to start, in one go. Creates the user's inbox the first time. */
  tree(owner: string): Tree {
    return this.tx(() => {
      const inbox = this.inbox(owner);
      const live = <T extends typeof notebooks | typeof sectionGroups | typeof sections>(t: T) =>
        and(eq(t.ownerId, owner), isNull(t.deletedAt));
      return {
        notebooks: this.orm
          .select()
          .from(notebooks)
          .where(live(notebooks))
          .orderBy(asc(notebooks.sortKey), asc(notebooks.id))
          .all()
          .map(toNotebook),
        groups: this.orm
          .select()
          .from(sectionGroups)
          .where(live(sectionGroups))
          .orderBy(asc(sectionGroups.sortKey), asc(sectionGroups.id))
          .all()
          .map(toGroup),
        sections: this.orm
          .select()
          .from(sections)
          .where(live(sections))
          .orderBy(asc(sections.sortKey), asc(sections.id))
          .all()
          .map(toSection),
        pages: this.orm
          .select(pageMetaColumns)
          .from(pages)
          .where(and(eq(pages.ownerId, owner), isNull(pages.deletedAt)))
          .orderBy(asc(pages.sortKey), asc(pages.id))
          .all()
          .map(toPageMeta),
        inboxId: inbox.id,
      };
    });
  }

  private inbox(owner: string): SectionRow {
    const existing = this.orm
      .select()
      .from(sections)
      .where(and(eq(sections.ownerId, owner), eq(sections.isInbox, true)))
      .get();
    if (existing) return existing;
    const now = this.now();
    return this.orm
      .insert(sections)
      .values({
        id: uuidv7(now),
        ownerId: owner,
        notebookId: null,
        groupId: null,
        name: INBOX_NAME,
        color: 'slate',
        sortKey: 'a0',
        isInbox: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }

  // Notebooks

  private liveNotebook(owner: string, id: string): NotebookRow {
    const row = this.orm
      .select()
      .from(notebooks)
      .where(and(eq(notebooks.id, id), eq(notebooks.ownerId, owner), isNull(notebooks.deletedAt)))
      .get();
    if (!row) throw notFound('Notebook not found.');
    return row;
  }

  private liveNotebooks(owner: string) {
    return this.orm
      .select({ id: notebooks.id, sortKey: notebooks.sortKey })
      .from(notebooks)
      .where(and(eq(notebooks.ownerId, owner), isNull(notebooks.deletedAt)))
      .all();
  }

  /** A new notebook comes with a first section, ready for pages. */
  createNotebook(owner: string, input: In<typeof createNotebookSchema>): TreeChanges {
    return this.tx(() => {
      const now = this.now();
      const [sortKey] = placeKeys(this.liveNotebooks(owner), null)!;
      const notebook = this.orm
        .insert(notebooks)
        .values({
          id: uuidv7(now),
          ownerId: owner,
          ...input,
          sortKey: sortKey!,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      const section = this.insertSection(owner, notebook.id, null, 'New section', input.color);
      return { notebooks: [toNotebook(notebook)], sections: [toSection(section)] };
    });
  }

  updateNotebook(owner: string, id: string, patch: In<typeof updateNotebookSchema>): TreeChanges {
    this.liveNotebook(owner, id);
    const row = this.orm
      .update(notebooks)
      .set({ ...patch, updatedAt: this.now() })
      .where(and(eq(notebooks.id, id), eq(notebooks.ownerId, owner)))
      .returning()
      .get()!;
    return { notebooks: [toNotebook(row)] };
  }

  moveNotebook(owner: string, id: string, beforeId: string | null): TreeChanges {
    return this.tx(() => {
      this.liveNotebook(owner, id);
      const siblings = this.liveNotebooks(owner).filter((n) => n.id !== id);
      const [sortKey] = placeKeys(siblings, beforeId) ?? fail(invalidMove('Can’t place it there.'));
      const row = this.orm
        .update(notebooks)
        .set({ sortKey })
        .where(eq(notebooks.id, id))
        .returning()
        .get()!;
      return { notebooks: [toNotebook(row)] };
    });
  }

  /** Moves the notebook, with everything in it, to the recycle bin. */
  deleteNotebook(owner: string, id: string): DeleteResponse {
    return this.tx(() => {
      this.liveNotebook(owner, id);
      const mark = { deletedAt: this.now(), deletedRootId: id };
      const inNotebook = <T extends typeof sectionGroups | typeof sections>(t: T) =>
        and(eq(t.ownerId, owner), eq(t.notebookId, id), isNull(t.deletedAt));
      this.orm
        .update(pages)
        .set(mark)
        .where(
          and(
            eq(pages.ownerId, owner),
            isNull(pages.deletedAt),
            inArray(
              pages.sectionId,
              this.orm.select({ id: sections.id }).from(sections).where(inNotebook(sections)),
            ),
          ),
        )
        .run();
      this.orm.update(sections).set(mark).where(inNotebook(sections)).run();
      this.orm.update(sectionGroups).set(mark).where(inNotebook(sectionGroups)).run();
      this.orm.update(notebooks).set(mark).where(eq(notebooks.id, id)).run();
      return { deleted: [{ type: 'notebook', id }] };
    });
  }

  // Section groups

  private liveGroup(owner: string, id: string): SectionGroupRow {
    const row = this.orm
      .select()
      .from(sectionGroups)
      .where(
        and(
          eq(sectionGroups.id, id),
          eq(sectionGroups.ownerId, owner),
          isNull(sectionGroups.deletedAt),
        ),
      )
      .get();
    if (!row) throw notFound('Section group not found.');
    return row;
  }

  private groupsOf(owner: string, notebookId: string): SectionGroupRow[] {
    return this.orm
      .select()
      .from(sectionGroups)
      .where(
        and(
          eq(sectionGroups.ownerId, owner),
          eq(sectionGroups.notebookId, notebookId),
          isNull(sectionGroups.deletedAt),
        ),
      )
      .all();
  }

  /** Checks that `parentGroupId` can hold groups `height` levels deep inside `notebookId`. */
  private checkGroupParent(
    owner: string,
    notebookId: string,
    parentGroupId: string | null,
    height: number,
  ): SectionGroupRow[] {
    this.liveNotebook(owner, notebookId);
    const groups = this.groupsOf(owner, notebookId);
    if (parentGroupId !== null) {
      const parent = this.liveGroup(owner, parentGroupId);
      if (parent.notebookId !== notebookId) throw invalidMove('That group is in another notebook.');
    }
    const byId = new Map(groups.map((g) => [g.id, g]));
    if (depthOf(byId, parentGroupId, groupParent) + height > MAX_GROUP_DEPTH) {
      throw tooDeep(`Section groups go at most ${MAX_GROUP_DEPTH} levels deep.`);
    }
    return groups;
  }

  /** A new group comes with a first section. */
  createGroup(owner: string, input: In<typeof createGroupSchema>): TreeChanges {
    return this.tx(() => {
      const { notebookId, parentGroupId, name } = input;
      const groups = this.checkGroupParent(owner, notebookId, parentGroupId, 1);
      const siblings = groups.filter((g) => g.parentGroupId === parentGroupId);
      const [sortKey] = placeKeys(siblings, null)!;
      const now = this.now();
      const group = this.orm
        .insert(sectionGroups)
        .values({
          id: uuidv7(now),
          ownerId: owner,
          notebookId,
          parentGroupId,
          name,
          sortKey: sortKey!,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      const used = this.orm
        .select({ color: sections.color })
        .from(sections)
        .where(
          and(
            eq(sections.ownerId, owner),
            eq(sections.notebookId, notebookId),
            isNull(sections.deletedAt),
          ),
        )
        .all();
      const color = pickColor(used.map((s) => s.color));
      const section = this.insertSection(owner, notebookId, group.id, 'New section', color);
      return { groups: [toGroup(group)], sections: [toSection(section)] };
    });
  }

  renameGroup(owner: string, id: string, name: string): TreeChanges {
    this.liveGroup(owner, id);
    const row = this.orm
      .update(sectionGroups)
      .set({ name, updatedAt: this.now() })
      .where(and(eq(sectionGroups.id, id), eq(sectionGroups.ownerId, owner)))
      .returning()
      .get()!;
    return { groups: [toGroup(row)] };
  }

  /** Moves a group, with its sections and subgroups, within or between notebooks. */
  moveGroup(owner: string, id: string, input: In<typeof moveGroupSchema>): TreeChanges {
    return this.tx(() => {
      const group = this.liveGroup(owner, id);
      const { notebookId, parentGroupId, beforeId } = input;
      // Everything below the group, including items already in the recycle bin: they must stay
      // in the group's notebook, so restoring them later puts them back in the right place.
      const subtree = this.db
        .prepare<[string, string], { id: string }>(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM section_groups WHERE id = ? AND owner_id = ?
             UNION ALL
             SELECT g.id FROM section_groups g JOIN sub ON g.parent_group_id = sub.id
           ) SELECT id FROM sub`,
        )
        .all(id, owner)
        .map((r) => r.id);
      if (parentGroupId !== null && subtree.includes(parentGroupId)) {
        throw invalidMove('A section group can’t go inside itself.');
      }
      const ownGroups = this.groupsOf(owner, group.notebookId);
      const height = heightOf(childrenByParent(ownGroups, groupParent), id);
      const groups = this.checkGroupParent(owner, notebookId, parentGroupId, height);
      const siblings = groups.filter((g) => g.parentGroupId === parentGroupId && g.id !== id);
      const [sortKey] = placeKeys(siblings, beforeId) ?? fail(invalidMove('Can’t place it there.'));

      this.orm
        .update(sectionGroups)
        .set({ parentGroupId, sortKey })
        .where(eq(sectionGroups.id, id))
        .run();
      if (notebookId === group.notebookId) {
        return { groups: [toGroup(this.liveGroup(owner, id))] };
      }
      for (const part of chunks(subtree)) {
        this.orm
          .update(sectionGroups)
          .set({ notebookId })
          .where(and(eq(sectionGroups.ownerId, owner), inArray(sectionGroups.id, part)))
          .run();
        this.orm
          .update(sections)
          .set({ notebookId })
          .where(and(eq(sections.ownerId, owner), inArray(sections.groupId, part)))
          .run();
      }
      return {
        groups: this.liveRows(sectionGroups, owner, subtree).map(toGroup),
        sections: this.orm
          .select()
          .from(sections)
          .where(
            and(
              eq(sections.ownerId, owner),
              isNull(sections.deletedAt),
              inArray(sections.groupId, subtree),
            ),
          )
          .all()
          .map(toSection),
      };
    });
  }

  deleteGroup(owner: string, id: string): DeleteResponse {
    return this.tx(() => {
      const group = this.liveGroup(owner, id);
      const groups = this.groupsOf(owner, group.notebookId);
      const ids = subtreeOf(childrenByParent(groups, groupParent), group).map((g) => g.id);
      const mark = { deletedAt: this.now(), deletedRootId: id };
      for (const part of chunks(ids)) {
        const inGroups = and(
          eq(sections.ownerId, owner),
          isNull(sections.deletedAt),
          inArray(sections.groupId, part),
        );
        this.orm
          .update(pages)
          .set(mark)
          .where(
            and(
              eq(pages.ownerId, owner),
              isNull(pages.deletedAt),
              inArray(
                pages.sectionId,
                this.orm.select({ id: sections.id }).from(sections).where(inGroups),
              ),
            ),
          )
          .run();
        this.orm.update(sections).set(mark).where(inGroups).run();
        this.orm
          .update(sectionGroups)
          .set(mark)
          .where(and(eq(sectionGroups.ownerId, owner), inArray(sectionGroups.id, part)))
          .run();
      }
      return { deleted: [{ type: 'group', id }] };
    });
  }

  // Sections

  private liveSection(owner: string, id: string): SectionRow {
    const row = this.orm
      .select()
      .from(sections)
      .where(and(eq(sections.id, id), eq(sections.ownerId, owner), isNull(sections.deletedAt)))
      .get();
    if (!row) throw notFound('Section not found.');
    return row;
  }

  /** Checks a section's new home and returns the sections already there. */
  private sectionSiblings(owner: string, notebookId: string, groupId: string | null) {
    this.liveNotebook(owner, notebookId);
    if (groupId !== null && this.liveGroup(owner, groupId).notebookId !== notebookId) {
      throw invalidMove('That group is in another notebook.');
    }
    return this.orm
      .select({ id: sections.id, sortKey: sections.sortKey })
      .from(sections)
      .where(
        and(
          eq(sections.ownerId, owner),
          eq(sections.notebookId, notebookId),
          groupId === null ? isNull(sections.groupId) : eq(sections.groupId, groupId),
          isNull(sections.deletedAt),
        ),
      )
      .all();
  }

  private insertSection(
    owner: string,
    notebookId: string,
    groupId: string | null,
    name: string,
    color: ColorId,
  ): SectionRow {
    const [sortKey] = placeKeys(this.sectionSiblings(owner, notebookId, groupId), null)!;
    const now = this.now();
    return this.orm
      .insert(sections)
      .values({
        id: uuidv7(now),
        ownerId: owner,
        notebookId,
        groupId,
        name,
        color,
        sortKey: sortKey!,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }

  createSection(owner: string, input: In<typeof createSectionSchema>): TreeChanges {
    return this.tx(() => {
      const { notebookId, groupId, name, color } = input;
      return { sections: [toSection(this.insertSection(owner, notebookId, groupId, name, color))] };
    });
  }

  updateSection(owner: string, id: string, patch: In<typeof updateSectionSchema>): TreeChanges {
    const section = this.liveSection(owner, id);
    if (section.isInbox && patch.name !== undefined && patch.name !== section.name) {
      throw new ApiError(409, 'conflict', 'The Inbox keeps its name.');
    }
    const row = this.orm
      .update(sections)
      .set({ ...patch, updatedAt: this.now() })
      .where(and(eq(sections.id, id), eq(sections.ownerId, owner)))
      .returning()
      .get()!;
    return { sections: [toSection(row)] };
  }

  moveSection(owner: string, id: string, input: In<typeof moveSectionSchema>): TreeChanges {
    return this.tx(() => {
      const section = this.liveSection(owner, id);
      if (section.isInbox) throw new ApiError(409, 'conflict', 'The Inbox stays where it is.');
      const { notebookId, groupId, beforeId } = input;
      const siblings = this.sectionSiblings(owner, notebookId, groupId).filter((s) => s.id !== id);
      const [sortKey] = placeKeys(siblings, beforeId) ?? fail(invalidMove('Can’t place it there.'));
      const row = this.orm
        .update(sections)
        .set({ notebookId, groupId, sortKey })
        .where(eq(sections.id, id))
        .returning()
        .get()!;
      return { sections: [toSection(row)] };
    });
  }

  deleteSection(owner: string, id: string): DeleteResponse {
    return this.tx(() => {
      const section = this.liveSection(owner, id);
      if (section.isInbox) throw new ApiError(409, 'conflict', 'The Inbox can’t be deleted.');
      const mark = { deletedAt: this.now(), deletedRootId: id };
      this.orm
        .update(pages)
        .set(mark)
        .where(and(eq(pages.ownerId, owner), eq(pages.sectionId, id), isNull(pages.deletedAt)))
        .run();
      this.orm.update(sections).set(mark).where(eq(sections.id, id)).run();
      return { deleted: [{ type: 'section', id }] };
    });
  }

  // Pages

  getPage(owner: string, id: string): Page {
    const row = this.livePage(owner, id);
    return {
      ...toPageMeta({ ...row, text: row.contentText.slice(0, SNIPPET_LENGTH * 2) }),
      content: row.content,
      viewMode: row.viewMode,
    };
  }

  /**
   * Saves a page's content if `baseRevision` is still its revision (D9); otherwise throws
   * `revision_conflict` with the current content, for the browser to merge. Content equal to
   * what is stored is never a conflict: a save repeated after a lost answer just succeeds.
   */
  saveContent(
    owner: string,
    id: string,
    input: In<typeof saveContentSchema>,
    deviceLabel: string,
  ): ContentSaved {
    return this.tx(() => {
      const row = this.livePage(owner, id);
      if (input.content === row.content) {
        return { revision: row.revision, pages: [toPageMeta({ ...row, text: row.contentText })] };
      }
      if (input.baseRevision !== row.revision) {
        throw new ApiError(409, 'revision_conflict', 'This page was changed elsewhere.', {
          revision: row.revision,
          content: row.content,
          type: row.type,
        } satisfies ContentConflict);
      }
      // The versioning hook (§9.7): keep what this save replaces, now and then, and always
      // when a conflict is being settled.
      const now = this.now();
      if (input.resolving) this.keepVersion(row, 'conflict', deviceLabel, now);
      else if (row.content !== '' && this.lastVersionAt(row.id) <= now - VERSION_INTERVAL_MS) {
        this.keepVersion(row, 'auto', deviceLabel, now);
      }
      const saved = this.orm
        .update(pages)
        .set({
          content: input.content,
          contentText: textOf(row.type, input.content),
          revision: row.revision + 1,
          updatedAt: now,
        })
        .where(eq(pages.id, row.id))
        .returning()
        .get()!;
      return {
        revision: saved.revision,
        pages: [toPageMeta({ ...saved, text: saved.contentText })],
      };
    });
  }

  /** Keeps the browser's side of a conflict it couldn't merge, so nothing is lost (§9.6). */
  createVersion(
    owner: string,
    id: string,
    input: In<typeof createVersionSchema>,
    deviceLabel: string,
  ): PageVersionMeta {
    const row = this.livePage(owner, id);
    return toVersionMeta(
      this.orm
        .insert(pageVersions)
        .values({
          id: uuidv7(this.now()),
          ownerId: owner,
          pageId: row.id,
          revision: input.baseRevision,
          type: row.type,
          title: row.title,
          content: input.content,
          reason: input.reason,
          deviceLabel,
          createdAt: this.now(),
        })
        .returning()
        .get(),
    );
  }

  private livePage(owner: string, id: string): PageRow {
    const row = this.orm
      .select()
      .from(pages)
      .where(and(eq(pages.id, id), eq(pages.ownerId, owner), isNull(pages.deletedAt)))
      .get();
    if (!row) throw notFound('Page not found.');
    return row;
  }

  private lastVersionAt(pageId: string): number {
    const last = this.orm
      .select({ createdAt: pageVersions.createdAt })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, pageId))
      .orderBy(desc(pageVersions.createdAt))
      .limit(1)
      .get();
    return last?.createdAt ?? 0;
  }

  private keepVersion(
    row: PageRow,
    reason: PageVersionRow['reason'],
    deviceLabel: string,
    now: number,
  ): void {
    this.orm
      .insert(pageVersions)
      .values({
        id: uuidv7(now),
        ownerId: row.ownerId,
        pageId: row.id,
        revision: row.revision,
        type: row.type,
        title: row.title,
        content: row.content,
        reason,
        deviceLabel,
        createdAt: now,
      })
      .run();
  }

  /** The page structure of some sections: enough to check and plan moves. */
  private pageNodes(owner: string, sectionIds: readonly string[]): PageNode[] {
    return chunks([...new Set(sectionIds)]).flatMap((part) =>
      this.orm
        .select({
          id: pages.id,
          sectionId: pages.sectionId,
          parentPageId: pages.parentPageId,
          sortKey: pages.sortKey,
        })
        .from(pages)
        .where(
          and(eq(pages.ownerId, owner), isNull(pages.deletedAt), inArray(pages.sectionId, part)),
        )
        .all(),
    );
  }

  /** The pages with these ids, all live and the caller's; otherwise "not found". */
  private livePageNodes(owner: string, ids: readonly string[]): PageNode[] {
    const found = chunks(ids).flatMap((part) =>
      this.orm
        .select({ id: pages.id, sectionId: pages.sectionId })
        .from(pages)
        .where(and(eq(pages.ownerId, owner), isNull(pages.deletedAt), inArray(pages.id, part)))
        .all(),
    );
    if (found.length !== ids.length) throw notFound('Page not found.');
    const nodes = this.pageNodes(
      owner,
      found.map((p) => p.sectionId),
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return ids.map((id) => byId.get(id)!);
  }

  /**
   * Where pages will go: checks the target and returns the section's structure, the selected
   * pages without those already inside another selected page, and new sort keys for them.
   */
  private planPlacement(
    owner: string,
    input: In<typeof placePagesSchema>,
    moving: boolean,
  ): { roots: PageNode[]; nodes: PageNode[]; keys: string[] } {
    const { ids, sectionId, parentPageId, beforeId } = input;
    this.liveSection(owner, sectionId);
    const selected = this.livePageNodes(owner, ids);
    const nodes = this.pageNodes(owner, [sectionId, ...selected.map((p) => p.sectionId)]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const children = childrenByParent(nodes, pageParent);
    const roots = topmost(selected, byId);

    if (parentPageId !== null) {
      const parent = byId.get(parentPageId) ?? this.livePageNodes(owner, [parentPageId])[0]!;
      if (parent.sectionId !== sectionId) throw invalidMove('That page is in another section.');
      if (moving && roots.some((r) => isWithin(byId, parentPageId, r.id, pageParent))) {
        throw invalidMove('A page can’t go inside itself.');
      }
    }
    const parentDepth = depthOf(byId, parentPageId, pageParent);
    if (roots.some((r) => parentDepth + heightOf(children, r.id) > MAX_PAGE_DEPTH)) {
      throw tooDeep(`Pages go at most ${MAX_PAGE_DEPTH} levels deep.`);
    }
    const rootIds = new Set(roots.map((r) => r.id));
    const siblings = (children.get(parentPageId) ?? []).filter(
      (n) => n.sectionId === sectionId && !(moving && rootIds.has(n.id)),
    );
    const keys =
      placeKeys(siblings, beforeId, roots.length) ?? fail(invalidMove('Can’t place it there.'));
    return { roots, nodes, keys };
  }

  createPage(owner: string, input: In<typeof createPageSchema>): TreeChanges {
    return this.tx(() => {
      const { id, sectionId, parentPageId, beforeId, title, type, content } = input;
      if (id !== undefined) {
        // A browser that created the page offline may send it again after a lost answer.
        const existing = this.orm.select().from(pages).where(eq(pages.id, id)).get();
        if (existing?.ownerId === owner) {
          return { pages: [toPageMeta({ ...existing, text: existing.contentText })] };
        }
        if (existing) throw new ApiError(409, 'conflict', 'That id is taken.');
      }
      this.liveSection(owner, sectionId);
      const nodes = this.pageNodes(owner, [sectionId]);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      if (parentPageId !== null && !byId.has(parentPageId)) {
        this.livePageNodes(owner, [parentPageId]);
        throw invalidMove('That page is in another section.');
      }
      if (depthOf(byId, parentPageId, pageParent) + 1 > MAX_PAGE_DEPTH) {
        throw tooDeep(`Pages go at most ${MAX_PAGE_DEPTH} levels deep.`);
      }
      const siblings = nodes.filter((n) => n.parentPageId === parentPageId);
      const [sortKey] = placeKeys(siblings, beforeId) ?? fail(invalidMove('Can’t place it there.'));
      const now = this.now();
      const row = this.orm
        .insert(pages)
        .values({
          id: id ?? uuidv7(now),
          ownerId: owner,
          sectionId,
          parentPageId,
          title,
          type,
          content,
          contentText: textOf(type, content),
          sortKey: sortKey!,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      return { pages: [toPageMeta({ ...row, text: row.contentText })] };
    });
  }

  updatePage(owner: string, id: string, patch: In<typeof updatePageSchema>): TreeChanges {
    this.getPage(owner, id);
    const row = this.orm
      .update(pages)
      .set({
        ...patch,
        // The view mode is a preference, not an edit: only a new title counts as a change.
        ...(patch.title === undefined ? {} : { updatedAt: this.now() }),
      })
      .where(and(eq(pages.id, id), eq(pages.ownerId, owner)))
      .returning()
      .get()!;
    return { pages: [toPageMeta({ ...row, text: row.contentText })] };
  }

  /** Moves pages, with their subpages, keeping the order they were given in. */
  movePages(owner: string, input: In<typeof placePagesSchema>): TreeChanges {
    return this.tx(() => {
      const { roots, nodes, keys } = this.planPlacement(owner, input, true);
      const children = childrenByParent(nodes, pageParent);
      const { sectionId, parentPageId } = input;
      const changed: string[] = [];
      roots.forEach((root, i) => {
        this.orm
          .update(pages)
          .set({ sectionId, parentPageId, sortKey: keys[i]! })
          .where(eq(pages.id, root.id))
          .run();
        changed.push(...subtreeOf(children, root).map((p) => p.id));
        if (root.sectionId === sectionId) return;
        // Subpages already in the recycle bin move too, so they come back in the right place.
        this.db
          .prepare(
            `WITH RECURSIVE sub(id) AS (
               SELECT id FROM pages WHERE parent_page_id = ? AND owner_id = ?
               UNION ALL
               SELECT p.id FROM pages p JOIN sub ON p.parent_page_id = sub.id
             ) UPDATE pages SET section_id = ? WHERE id IN (SELECT id FROM sub)`,
          )
          .run(root.id, owner, sectionId);
      });
      return { pages: this.pageMetas(owner, changed) };
    });
  }

  /** Copies pages, with their subpages and content, to one place. */
  copyPages(
    owner: string,
    input: In<typeof placePagesSchema>,
    rename: (title: string) => string = (title) => title,
  ): TreeChanges {
    return this.tx(() => {
      const { roots, nodes, keys } = this.planPlacement(owner, input, false);
      const children = childrenByParent(nodes, pageParent);
      const now = this.now();
      const created: string[] = [];
      roots.forEach((root, i) => {
        const subtree = subtreeOf(children, root).map((p) => p.id);
        const rows = new Map(
          chunks(subtree)
            .flatMap((part) => this.orm.select().from(pages).where(inArray(pages.id, part)).all())
            .map((r) => [r.id, r]),
        );
        const newIds = new Map(subtree.map((id) => [id, uuidv7(now)]));
        for (const id of subtree) {
          const source = rows.get(id)!;
          const isRoot = id === root.id;
          this.orm
            .insert(pages)
            .values({
              ...source,
              id: newIds.get(id)!,
              sectionId: input.sectionId,
              parentPageId: isRoot ? input.parentPageId : newIds.get(source.parentPageId!)!,
              title: isRoot ? rename(source.title) : source.title,
              sortKey: isRoot ? keys[i]! : source.sortKey,
              revision: 1,
              createdAt: now,
              updatedAt: now,
            })
            .run();
          created.push(newIds.get(id)!);
        }
      });
      return { pages: this.pageMetas(owner, created) };
    });
  }

  /** Copies a page, with its subpages, right after itself. */
  duplicatePage(owner: string, id: string): TreeChanges {
    return this.tx(() => {
      const [page] = this.livePageNodes(owner, [id]);
      const siblings = this.pageNodes(owner, [page!.sectionId])
        .filter((n) => n.parentPageId === page!.parentPageId)
        .sort(bySortKey);
      const next = siblings[siblings.findIndex((n) => n.id === id) + 1];
      return this.copyPages(
        owner,
        {
          ids: [id],
          sectionId: page!.sectionId,
          parentPageId: page!.parentPageId,
          beforeId: next?.id ?? null,
        },
        (title) => (title ? `${title} (copy)`.slice(0, 200) : title),
      );
    });
  }

  /** Moves pages, with their subpages, to the recycle bin. */
  deletePages(owner: string, ids: readonly string[]): DeleteResponse {
    return this.tx(() => {
      const selected = this.livePageNodes(owner, ids);
      const nodes = this.pageNodes(
        owner,
        selected.map((p) => p.sectionId),
      );
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const children = childrenByParent(nodes, pageParent);
      const roots = topmost(selected, byId);
      const now = this.now();
      for (const root of roots) {
        const below = subtreeOf(children, root).map((p) => p.id);
        for (const part of chunks(below)) {
          this.orm
            .update(pages)
            .set({ deletedAt: now, deletedRootId: root.id })
            .where(inArray(pages.id, part))
            .run();
        }
      }
      return { deleted: roots.map((r): TrashItem => ({ type: 'page', id: r.id })) };
    });
  }

  private pageMetas(owner: string, ids: readonly string[]): PageMeta[] {
    return chunks(ids).flatMap((part) =>
      this.orm
        .select(pageMetaColumns)
        .from(pages)
        .where(and(eq(pages.ownerId, owner), inArray(pages.id, part)))
        .all()
        .map(toPageMeta),
    );
  }

  private liveRows<T extends typeof sectionGroups>(
    table: T,
    owner: string,
    ids: readonly string[],
  ) {
    return chunks(ids).flatMap((part) =>
      this.orm
        .select()
        .from(table)
        .where(and(eq(table.ownerId, owner), isNull(table.deletedAt), inArray(table.id, part)))
        .all(),
    );
  }

  // Recycle bin

  /**
   * Restores deleted items, each with everything that was deleted along with it. An item whose
   * notebook, section or parent is itself in the recycle bin can't come back on its own.
   */
  restore(owner: string, items: readonly TrashItem[]): TreeChanges {
    const rank = { notebook: 0, group: 1, section: 2, page: 3 } as const;
    return this.tx(() => {
      const restored = {
        notebooks: new Set<string>(),
        groups: new Set<string>(),
        sections: new Set<string>(),
        pages: new Set<string>(),
      };
      for (const item of [...items].sort((a, b) => rank[a.type] - rank[b.type])) {
        this.checkRestorable(owner, item);
        const where = <
          T extends typeof notebooks | typeof sectionGroups | typeof sections | typeof pages,
        >(
          t: T,
        ) => and(eq(t.ownerId, owner), eq(t.deletedRootId, item.id));
        const back = { deletedAt: null, deletedRootId: null };
        for (const r of this.orm
          .update(pages)
          .set(back)
          .where(where(pages))
          .returning({ id: pages.id })
          .all())
          restored.pages.add(r.id);
        for (const r of this.orm
          .update(sections)
          .set(back)
          .where(where(sections))
          .returning({ id: sections.id })
          .all())
          restored.sections.add(r.id);
        for (const r of this.orm
          .update(sectionGroups)
          .set(back)
          .where(where(sectionGroups))
          .returning({ id: sectionGroups.id })
          .all())
          restored.groups.add(r.id);
        for (const r of this.orm
          .update(notebooks)
          .set(back)
          .where(where(notebooks))
          .returning({ id: notebooks.id })
          .all())
          restored.notebooks.add(r.id);
        this.resolveSortKeyClash(owner, item);
      }
      return {
        notebooks: [...restored.notebooks].map((id) => toNotebook(this.liveNotebook(owner, id))),
        groups: this.liveRows(sectionGroups, owner, [...restored.groups]).map(toGroup),
        sections: [...restored.sections].map((id) => toSection(this.liveSection(owner, id))),
        pages: this.pageMetas(owner, [...restored.pages]),
      };
    });
  }

  private checkRestorable(owner: string, { type, id }: TrashItem): void {
    const table = { notebook: notebooks, group: sectionGroups, section: sections, page: pages }[
      type
    ];
    const row = this.orm
      .select()
      .from(table)
      .where(and(eq(table.id, id), eq(table.ownerId, owner), eq(table.deletedRootId, id)))
      .get() as Partial<SectionGroupRow & SectionRow & PageRow> | undefined;
    if (!row) throw notFound('Not in the recycle bin.');
    const alive = (check: () => unknown) => {
      try {
        check();
        return true;
      } catch {
        return false;
      }
    };
    if (row.notebookId && !alive(() => this.liveNotebook(owner, row.notebookId!))) {
      throw inBin('Its notebook is in the recycle bin. Restore that first.');
    }
    const parentGroup =
      type === 'group' ? row.parentGroupId : type === 'section' ? row.groupId : null;
    if (parentGroup && !alive(() => this.liveGroup(owner, parentGroup))) {
      throw inBin('Its section group is in the recycle bin. Restore that first.');
    }
    if (type === 'page') {
      if (!alive(() => this.liveSection(owner, row.sectionId!))) {
        throw inBin('Its section is in the recycle bin. Restore that first.');
      }
      if (row.parentPageId && !alive(() => this.getPage(owner, row.parentPageId!))) {
        throw inBin('Its parent page is in the recycle bin. Restore that first.');
      }
    }
  }

  /** A restored item takes a new place at the end if its old one was taken in the meantime. */
  private resolveSortKeyClash(owner: string, { type, id }: TrashItem): void {
    const siblings = ((): { id: string; sortKey: string }[] => {
      switch (type) {
        case 'notebook':
          return this.liveNotebooks(owner);
        case 'group': {
          const group = this.liveGroup(owner, id);
          return this.groupsOf(owner, group.notebookId).filter(
            (g) => g.parentGroupId === group.parentGroupId,
          );
        }
        case 'section': {
          const section = this.liveSection(owner, id);
          return this.sectionSiblings(owner, section.notebookId!, section.groupId);
        }
        case 'page': {
          const page = this.getPage(owner, id);
          return this.pageNodes(owner, [page.sectionId]).filter(
            (p) => p.parentPageId === page.parentPageId,
          );
        }
      }
    })();
    const self = siblings.find((s) => s.id === id)!;
    const others = siblings.filter((s) => s.id !== id);
    if (!others.some((s) => s.sortKey === self.sortKey)) return;
    const [sortKey] = placeKeys(others, null)!;
    const table = { notebook: notebooks, group: sectionGroups, section: sections, page: pages }[
      type
    ];
    this.orm
      .update(table)
      .set({ sortKey })
      .where(and(eq(table.id, id), eq(table.ownerId, owner)))
      .run();
  }
}

/** The selected pages that aren't inside another selected page (those go along with it). */
function topmost(selected: readonly PageNode[], byId: ReadonlyMap<string, PageNode>): PageNode[] {
  return selected.filter(
    (p) => !selected.some((o) => o.id !== p.id && isWithin(byId, p.parentPageId, o.id, pageParent)),
  );
}

function fail(error: Error): never {
  throw error;
}
