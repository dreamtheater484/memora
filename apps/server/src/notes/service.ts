import {
  INBOX_NAME,
  MAX_GROUP_DEPTH,
  MAX_PAGE_DEPTH,
  SNIPPET_LENGTH,
  bySortKey,
  childrenByParent,
  depthOf,
  heightOf,
  isRichContent,
  isWithin,
  linkedTitles,
  markdownToText,
  pickColor,
  placeKeys,
  renameLinks,
  richToText,
  snippetOf,
  subtreeOf,
  tagKey,
  titleKey,
  uuidv7,
  type ColorId,
  type ContentConflict,
  type ContentSaved,
  type DeleteResponse,
  type PageVersion,
  type PurgeResult,
  type TrashEntry,
  type TrashList,
  type VersionKept,
  type Notebook,
  type NotebookIcon,
  type Page,
  type PageMeta,
  type PageVersionMeta,
  type Section,
  type SectionGroup,
  type Tag,
  type TrashItem,
  type Tree,
  type TreeChanges,
  type convertPageSchema,
  type createGroupSchema,
  type createNotebookSchema,
  type createPageSchema,
  type createSectionSchema,
  type createVersionSchema,
  type moveGroupSchema,
  type moveSectionSchema,
  type nameVersionSchema,
  type restoreToSchema,
  type placePagesSchema,
  type saveContentSchema,
  type updateNotebookSchema,
  type updatePageSchema,
  type updateSectionSchema,
  type updateTagSchema,
} from '@memora/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { SqliteDatabase } from '../db/client';
import {
  notebooks,
  pageLinks,
  pageTags,
  pageVersions,
  pages,
  sectionGroups,
  sections,
  tags,
  type NotebookRow,
  type PageRow,
  type PageVersionRow,
  type SectionGroupRow,
  type SectionRow,
  type TagRow,
} from '../db/schema';
import { ApiError, notFound } from '../errors';
import { versionsToThin, type RetentionRules } from './retention';
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
  tags: sql<
    string | null
  >`(SELECT group_concat(${pageTags.tagId}) FROM ${pageTags} WHERE ${pageTags.pageId} = ${pages.id})`,
};

type MetaRow = Omit<PageMeta, 'snippet' | 'tags'> & { text: string; tags?: string | null };

const toPageMeta = ({ text, tags: tagIds, ...row }: MetaRow) =>
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
    ...(tagIds ? { tags: tagIds.split(',').sort() } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }) satisfies PageMeta;

const toTag = (r: TagRow): Tag => ({
  id: r.id,
  name: r.name,
  color: (r.color as ColorId | null) ?? null,
  createdAt: r.createdAt,
});

type VersionMetaRow = Omit<PageVersionRow, 'content' | 'ownerId' | 'title'> & { size: number };

const versionMetaColumns = {
  id: pageVersions.id,
  pageId: pageVersions.pageId,
  revision: pageVersions.revision,
  reason: pageVersions.reason,
  name: pageVersions.name,
  type: pageVersions.type,
  deviceLabel: pageVersions.deviceLabel,
  createdAt: pageVersions.createdAt,
};

const toVersionMeta = (r: VersionMetaRow): PageVersionMeta => ({
  id: r.id,
  pageId: r.pageId,
  revision: r.revision,
  reason: r.reason,
  name: r.name,
  type: r.type,
  size: r.size,
  deviceLabel: r.deviceLabel,
  createdAt: r.createdAt,
});

const textOf = (type: PageRow['type'], content: string) =>
  type === 'markdown' ? markdownToText(content) : richToText(content);

/** Rich pages hold a document (§8.3): anything else would leave the page unreadable. */
function checkContent(type: PageRow['type'], content: string): void {
  if (type === 'rich' && !isRichContent(content)) {
    throw new ApiError(400, 'invalid_content', 'This isn’t a rich text document.');
  }
}

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
        tags: this.orm
          .select()
          .from(tags)
          .where(eq(tags.ownerId, owner))
          .orderBy(asc(tags.nameKey))
          .all()
          .map(toTag),
      };
    });
  }

  /** A page's row as the tree has it, with its tags. */
  private metaOf(row: PageRow): PageMeta {
    const ids = this.orm
      .select({ id: pageTags.tagId })
      .from(pageTags)
      .where(eq(pageTags.pageId, row.id))
      .all()
      .map((t) => t.id);
    return toPageMeta({
      ...row,
      text: row.contentText.slice(0, SNIPPET_LENGTH * 2),
      tags: ids.join(',') || null,
    });
  }

  /** Rebuilds the list of titles a page links to (§9.9), after its content changed. */
  private indexLinks(pageId: string, type: PageRow['type'], content: string): void {
    this.orm.delete(pageLinks).where(eq(pageLinks.sourcePageId, pageId)).run();
    const titles = linkedTitles(type, content);
    for (const part of chunks(titles)) {
      this.orm
        .insert(pageLinks)
        .values(part.map((t) => ({ sourcePageId: pageId, targetTitle: t, targetKey: titleKey(t) })))
        .onConflictDoNothing()
        .run();
    }
  }

  /** The user's inbox, made the first time it is needed. */
  inbox(owner: string): SectionRow {
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
      ...this.metaOf(row),
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
        return { revision: row.revision, pages: [this.metaOf(row)] };
      }
      if (input.baseRevision !== row.revision) {
        throw new ApiError(409, 'revision_conflict', 'This page was changed elsewhere.', {
          revision: row.revision,
          content: row.content,
          type: row.type,
        } satisfies ContentConflict);
      }
      checkContent(row.type, input.content);
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
      this.indexLinks(saved.id, saved.type, saved.content);
      return {
        revision: saved.revision,
        pages: [this.metaOf(saved)],
      };
    });
  }

  /**
   * Turns a page into the other type (§9.4), with the content the browser converted. The
   * content it replaces is always kept as a version first, so a conversion can be undone.
   */
  convertPage(
    owner: string,
    id: string,
    input: In<typeof convertPageSchema>,
    deviceLabel: string,
  ): ContentSaved {
    return this.tx(() => {
      const row = this.livePage(owner, id);
      if (row.type === input.type) {
        throw new ApiError(409, 'conflict', 'The page already has this type.');
      }
      if (input.baseRevision !== row.revision) {
        throw new ApiError(409, 'revision_conflict', 'This page was changed elsewhere.', {
          revision: row.revision,
          content: row.content,
          type: row.type,
        } satisfies ContentConflict);
      }
      checkContent(input.type, input.content);
      const now = this.now();
      this.keepVersion(row, 'conversion', deviceLabel, now);
      const saved = this.orm
        .update(pages)
        .set({
          type: input.type,
          content: input.content,
          contentText: textOf(input.type, input.content),
          revision: row.revision + 1,
          updatedAt: now,
        })
        .where(eq(pages.id, row.id))
        .returning()
        .get()!;
      this.indexLinks(saved.id, saved.type, saved.content);
      return {
        revision: saved.revision,
        pages: [this.metaOf(saved)],
      };
    });
  }

  /**
   * `POST /pages/:id/versions`: the browser's side of a conflict it couldn't merge (so nothing
   * is lost, §9.6), or a snapshot of the page as it is: saved by hand, or as a page that was
   * edited is closed (§9.7). A snapshot equal to the latest version isn't kept again.
   */
  createVersion(
    owner: string,
    id: string,
    input: In<typeof createVersionSchema>,
    deviceLabel: string,
  ): VersionKept {
    return this.tx(() => {
      const row = this.livePage(owner, id);
      const now = this.now();
      if (input.reason === 'conflict') {
        const kept = this.insertVersion(row, 'conflict', deviceLabel, now, {
          revision: input.baseRevision,
          content: input.content,
        });
        return { version: kept };
      }
      const latest = this.orm
        .select({ content: pageVersions.content, type: pageVersions.type })
        .from(pageVersions)
        .where(eq(pageVersions.pageId, row.id))
        .orderBy(desc(pageVersions.createdAt), desc(pageVersions.id))
        .limit(1)
        .get();
      const unchanged = latest && latest.content === row.content && latest.type === row.type;
      if (input.reason === 'auto' && (unchanged || row.content === '')) return { version: null };
      if (input.reason === 'manual' && unchanged && !input.name) return { version: null };
      const name = input.reason === 'manual' ? (input.name ?? null) : null;
      return { version: this.insertVersion(row, input.reason, deviceLabel, now, { name }) };
    });
  }

  /** The page's versions, newest first, without their content. */
  listVersions(owner: string, id: string): PageVersionMeta[] {
    const row = this.livePage(owner, id);
    return this.orm
      .select({ ...versionMetaColumns, size: sql<number>`length(${pageVersions.content})` })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, row.id))
      .orderBy(desc(pageVersions.createdAt), desc(pageVersions.id))
      .all()
      .map(toVersionMeta);
  }

  getVersion(owner: string, id: string, versionId: string): PageVersion {
    const version = this.version(owner, id, versionId);
    return {
      ...toVersionMeta({ ...version, size: version.content.length }),
      title: version.title,
      content: version.content,
    };
  }

  /** Names a version (it is then always kept), or takes its name away. */
  nameVersion(
    owner: string,
    id: string,
    versionId: string,
    input: In<typeof nameVersionSchema>,
  ): PageVersionMeta {
    this.version(owner, id, versionId);
    const row = this.orm
      .update(pageVersions)
      .set({ name: input.name })
      .where(eq(pageVersions.id, versionId))
      .returning()
      .get()!;
    return toVersionMeta({ ...row, size: row.content.length });
  }

  /**
   * Makes a version the page's content again (§9.7). What it replaces is kept as a version
   * first, so a restore can itself be undone.
   */
  restoreVersion(owner: string, id: string, versionId: string, deviceLabel: string): ContentSaved {
    return this.tx(() => {
      const version = this.version(owner, id, versionId);
      const row = this.livePage(owner, id);
      const now = this.now();
      if (row.content !== version.content || row.type !== version.type) {
        this.insertVersion(row, 'restore', deviceLabel, now);
      }
      const saved = this.orm
        .update(pages)
        .set({
          type: version.type,
          content: version.content,
          contentText: textOf(version.type, version.content),
          revision: row.revision + 1,
          updatedAt: now,
        })
        .where(eq(pages.id, row.id))
        .returning()
        .get()!;
      this.indexLinks(saved.id, saved.type, saved.content);
      return {
        revision: saved.revision,
        pages: [this.metaOf(saved)],
      };
    });
  }

  /** "Restore as copy": a new page with the version's content, right after the page. */
  copyVersion(owner: string, id: string, versionId: string): TreeChanges {
    return this.tx(() => {
      const version = this.version(owner, id, versionId);
      const row = this.livePage(owner, id);
      const siblings = this.pageNodes(owner, [row.sectionId])
        .filter((n) => n.parentPageId === row.parentPageId)
        .sort(bySortKey);
      const next = siblings[siblings.findIndex((n) => n.id === id) + 1];
      const [sortKey] =
        placeKeys(siblings, next?.id ?? null) ?? fail(invalidMove('Can’t place it there.'));
      const now = this.now();
      const date = new Date(version.createdAt).toISOString().slice(0, 16).replace('T', ' ');
      const title = `${version.title || 'Untitled page'} (${date})`.slice(0, 200);
      const created = this.orm
        .insert(pages)
        .values({
          id: uuidv7(now),
          ownerId: owner,
          sectionId: row.sectionId,
          parentPageId: row.parentPageId,
          title,
          type: version.type,
          content: version.content,
          contentText: textOf(version.type, version.content),
          sortKey: sortKey!,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      this.indexLinks(created.id, created.type, created.content);
      return { pages: [this.metaOf(created)] };
    });
  }

  /** Thins out every page's versions by the retention rules (§9.7); answers how many went. */
  thinVersions(rules: RetentionRules): number {
    const now = this.now();
    const byPage = new Map<string, { id: string; createdAt: number; name: string | null }[]>();
    for (const v of this.db
      .prepare('SELECT id, page_id AS pageId, created_at AS createdAt, name FROM page_versions')
      .iterate() as Iterable<{
      id: string;
      pageId: string;
      createdAt: number;
      name: string | null;
    }>) {
      if (now - v.createdAt < rules.allMs && !v.name) continue;
      let list = byPage.get(v.pageId);
      if (!list) byPage.set(v.pageId, (list = []));
      list.push(v);
    }
    const thin = [...byPage.values()].flatMap((list) => versionsToThin(list, now, rules));
    this.tx(() => {
      for (const part of chunks(thin)) {
        this.orm.delete(pageVersions).where(inArray(pageVersions.id, part)).run();
      }
    });
    return thin.length;
  }

  private version(owner: string, pageId: string, versionId: string): PageVersionRow {
    this.livePage(owner, pageId);
    const version = this.orm
      .select()
      .from(pageVersions)
      .where(
        and(
          eq(pageVersions.id, versionId),
          eq(pageVersions.pageId, pageId),
          eq(pageVersions.ownerId, owner),
        ),
      )
      .get();
    if (!version) throw notFound('Version not found.');
    return version;
  }

  private insertVersion(
    row: PageRow,
    reason: PageVersionRow['reason'],
    deviceLabel: string,
    now: number,
    extra: { revision?: number; content?: string; name?: string | null } = {},
  ): PageVersionMeta {
    const content = extra.content ?? row.content;
    const kept = this.orm
      .insert(pageVersions)
      .values({
        id: uuidv7(now),
        ownerId: row.ownerId,
        pageId: row.id,
        revision: extra.revision ?? row.revision,
        type: row.type,
        title: row.title,
        content,
        reason,
        name: extra.name ?? null,
        deviceLabel,
        createdAt: now,
      })
      .returning()
      .get();
    return toVersionMeta({ ...kept, size: content.length });
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
    this.insertVersion(row, reason, deviceLabel, now);
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
          return { pages: [this.metaOf(existing)] };
        }
        if (existing) throw new ApiError(409, 'conflict', 'That id is taken.');
      }
      this.liveSection(owner, sectionId);
      checkContent(type, content);
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
      this.indexLinks(row.id, row.type, row.content);
      return { pages: [this.metaOf(row)] };
    });
  }

  /**
   * Renames a page or changes its view mode. A new title is written into every link to the
   * page (§9.9), unless another page still has the old one; the pages whose links changed
   * follow the page in the answer.
   */
  updatePage(
    owner: string,
    id: string,
    patch: In<typeof updatePageSchema>,
    deviceLabel = '',
  ): TreeChanges {
    return this.tx(() => {
      const before = this.livePage(owner, id);
      const now = this.now();
      const row = this.orm
        .update(pages)
        .set({
          ...patch,
          // The view mode is a preference, not an edit: only a new title counts as a change.
          ...(patch.title === undefined ? {} : { updatedAt: now }),
        })
        .where(eq(pages.id, id))
        .returning()
        .get()!;
      const changed = [this.metaOf(row)];
      if (patch.title !== undefined && patch.title !== before.title) {
        changed.push(...this.renameLinksTo(owner, before, patch.title, deviceLabel, now));
      }
      return { pages: changed };
    });
  }

  /** Points the links to `page` at its new title; answers the pages that changed. */
  private renameLinksTo(
    owner: string,
    page: PageRow,
    to: string,
    deviceLabel: string,
    now: number,
  ): PageMeta[] {
    const from = page.title;
    const key = titleKey(from);
    if (!key || !to.trim()) return [];
    // While another page has the old title, the links lead there.
    const namesake = this.orm
      .select({ id: pages.id, title: pages.title })
      .from(pages)
      .where(and(eq(pages.ownerId, owner), isNull(pages.deletedAt)))
      .all()
      .some((p) => p.id !== page.id && titleKey(p.title) === key);
    if (namesake) return [];
    const sources = this.orm
      .select({ page: pages })
      .from(pageLinks)
      .innerJoin(pages, eq(pages.id, pageLinks.sourcePageId))
      .where(and(eq(pageLinks.targetKey, key), eq(pages.ownerId, owner), isNull(pages.deletedAt)))
      .all()
      .map((r) => r.page);
    const changed: PageMeta[] = [];
    for (const source of sources) {
      const content = renameLinks(source.type, source.content, from, to);
      if (content === null) continue;
      if (this.lastVersionAt(source.id) <= now - VERSION_INTERVAL_MS) {
        this.keepVersion(source, 'auto', deviceLabel, now);
      }
      const saved = this.orm
        .update(pages)
        .set({
          content,
          contentText: textOf(source.type, content),
          revision: source.revision + 1,
          updatedAt: now,
        })
        .where(eq(pages.id, source.id))
        .returning()
        .get()!;
      this.indexLinks(saved.id, saved.type, saved.content);
      changed.push(this.metaOf(saved));
    }
    return changed;
  }

  /** The live pages that link to this one, by its title. */
  backlinks(owner: string, id: string): string[] {
    const page = this.livePage(owner, id);
    const key = titleKey(page.title);
    if (!key) return [];
    return this.orm
      .select({ id: pages.id })
      .from(pageLinks)
      .innerJoin(pages, eq(pages.id, pageLinks.sourcePageId))
      .where(and(eq(pageLinks.targetKey, key), eq(pages.ownerId, owner), isNull(pages.deletedAt)))
      .orderBy(desc(pages.updatedAt))
      .all()
      .map((r) => r.id)
      .filter((source) => source !== id);
  }

  // Tags (§9.9)

  /** Sets a page's tags by name, making the ones that don't exist yet. */
  setPageTags(owner: string, id: string, names: readonly string[]): TreeChanges {
    return this.tx(() => {
      const row = this.livePage(owner, id);
      const existing = new Map(
        this.orm
          .select()
          .from(tags)
          .where(eq(tags.ownerId, owner))
          .all()
          .map((t) => [t.nameKey, t]),
      );
      const now = this.now();
      const wanted = new Map<string, TagRow>();
      const created: TagRow[] = [];
      for (const name of names) {
        const key = tagKey(name);
        if (wanted.has(key)) continue;
        let tag = existing.get(key);
        if (!tag) {
          tag = this.orm
            .insert(tags)
            .values({
              id: uuidv7(now),
              ownerId: owner,
              name: name.trim(),
              nameKey: key,
              createdAt: now,
            })
            .returning()
            .get();
          existing.set(key, tag);
          created.push(tag);
        }
        wanted.set(key, tag);
      }
      const ids = [...wanted.values()].map((t) => t.id);
      const current = this.orm
        .select({ tagId: pageTags.tagId })
        .from(pageTags)
        .where(eq(pageTags.pageId, id))
        .all()
        .map((t) => t.tagId);
      const gone = current.filter((t) => !ids.includes(t));
      if (gone.length) {
        this.orm
          .delete(pageTags)
          .where(and(eq(pageTags.pageId, id), inArray(pageTags.tagId, gone)))
          .run();
      }
      const added = ids.filter((t) => !current.includes(t));
      if (added.length) {
        this.orm
          .insert(pageTags)
          .values(added.map((tagId) => ({ pageId: id, tagId })))
          .run();
      }
      return { pages: [this.metaOf(row)], tags: created.map(toTag) };
    });
  }

  private liveTag(owner: string, id: string): TagRow {
    const tag = this.orm
      .select()
      .from(tags)
      .where(and(eq(tags.id, id), eq(tags.ownerId, owner)))
      .get();
    if (!tag) throw notFound('Tag not found.');
    return tag;
  }

  updateTag(owner: string, id: string, patch: In<typeof updateTagSchema>): TreeChanges {
    return this.tx(() => {
      const tag = this.liveTag(owner, id);
      const next: Partial<TagRow> = {};
      if (patch.name !== undefined) {
        const key = tagKey(patch.name);
        const clash = this.orm
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.ownerId, owner), eq(tags.nameKey, key)))
          .get();
        if (clash && clash.id !== id) {
          throw new ApiError(409, 'conflict', 'There is a tag with that name already.');
        }
        next.name = patch.name.trim();
        next.nameKey = key;
      }
      if (patch.color !== undefined) next.color = patch.color;
      const saved = this.orm.update(tags).set(next).where(eq(tags.id, tag.id)).returning().get()!;
      return { tags: [toTag(saved)] };
    });
  }

  /** Deletes a tag and takes it off its pages; answers those pages. */
  deleteTag(owner: string, id: string): TreeChanges {
    return this.tx(() => {
      this.liveTag(owner, id);
      const tagged = this.orm
        .select({ pageId: pageTags.pageId })
        .from(pageTags)
        .where(eq(pageTags.tagId, id))
        .all()
        .map((t) => t.pageId);
      // Row by row, so the search index hears of each (its triggers).
      this.orm.delete(pageTags).where(eq(pageTags.tagId, id)).run();
      this.orm.delete(tags).where(eq(tags.id, id)).run();
      return { pages: this.pageMetas(owner, tagged) };
    });
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
          // A copy has the same tags and links.
          const tagIds = this.orm
            .select({ tagId: pageTags.tagId })
            .from(pageTags)
            .where(eq(pageTags.pageId, id))
            .all();
          if (tagIds.length) {
            this.orm
              .insert(pageTags)
              .values(tagIds.map((t) => ({ pageId: newIds.get(id)!, tagId: t.tagId })))
              .run();
          }
          this.indexLinks(newIds.get(id)!, source.type, source.content);
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

  // Recycle bin (§9.7)

  /** Every item deleted on its own (with what went with it), newest first. */
  listTrash(owner: string, trashMs: number): TrashList {
    const notebookRows = this.orm
      .select()
      .from(notebooks)
      .where(eq(notebooks.ownerId, owner))
      .all();
    const groupRows = this.orm
      .select()
      .from(sectionGroups)
      .where(eq(sectionGroups.ownerId, owner))
      .all();
    const sectionRows = this.orm.select().from(sections).where(eq(sections.ownerId, owner)).all();
    const deletedPages = this.orm
      .select({
        id: pages.id,
        title: pages.title,
        sectionId: pages.sectionId,
        parentPageId: pages.parentPageId,
        deletedAt: pages.deletedAt,
        deletedRootId: pages.deletedRootId,
      })
      .from(pages)
      .where(and(eq(pages.ownerId, owner), isNotNull(pages.deletedAt)))
      .all();
    const byNotebook = new Map(notebookRows.map((r) => [r.id, r]));
    const byGroup = new Map(groupRows.map((r) => [r.id, r]));
    const bySection = new Map(sectionRows.map((r) => [r.id, r]));
    const pageCount = new Map<string, number>();
    for (const p of deletedPages) {
      if (p.deletedRootId)
        pageCount.set(p.deletedRootId, (pageCount.get(p.deletedRootId) ?? 0) + 1);
    }
    const alive = (row: { deletedAt: number | null } | undefined) =>
      !!row && row.deletedAt === null;
    const groupPath = (id: string | null): string[] => {
      const names: string[] = [];
      for (
        let g = id ? byGroup.get(id) : undefined;
        g;
        g = g.parentGroupId ? byGroup.get(g.parentGroupId) : undefined
      ) {
        names.unshift(g.name);
      }
      return names;
    };
    const notebookName = (id: string | null) => (id ? (byNotebook.get(id)?.name ?? '') : '');
    const sectionPlace = (section: SectionRow | undefined): string[] =>
      !section
        ? []
        : section.isInbox
          ? []
          : [notebookName(section.notebookId), ...groupPath(section.groupId)];
    const entry = (
      type: TrashEntry['type'],
      row: { id: string; deletedAt: number | null },
      name: string,
      location: string[],
      restorable: boolean,
    ): TrashEntry => ({
      type,
      id: row.id,
      name,
      location: location.filter(Boolean),
      pages: pageCount.get(row.id) ?? 0,
      deletedAt: row.deletedAt!,
      purgeAt: row.deletedAt! + trashMs,
      restorable,
    });
    const entries: TrashEntry[] = [
      ...notebookRows
        .filter((r) => r.deletedRootId === r.id)
        .map((r) => entry('notebook', r, r.name, [], true)),
      ...groupRows
        .filter((r) => r.deletedRootId === r.id)
        .map((r) =>
          entry(
            'group',
            r,
            r.name,
            [notebookName(r.notebookId), ...groupPath(r.parentGroupId)],
            alive(byNotebook.get(r.notebookId)) &&
              (r.parentGroupId === null || alive(byGroup.get(r.parentGroupId))),
          ),
        ),
      ...sectionRows
        .filter((r) => r.deletedRootId === r.id)
        .map((r) =>
          entry(
            'section',
            r,
            r.name,
            sectionPlace(r),
            (r.notebookId === null || alive(byNotebook.get(r.notebookId))) &&
              (r.groupId === null || alive(byGroup.get(r.groupId))),
          ),
        ),
      ...deletedPages
        .filter((p) => p.deletedRootId === p.id)
        .map((p) => {
          const section = bySection.get(p.sectionId);
          const parentAlive =
            p.parentPageId === null ||
            !!this.orm
              .select({ id: pages.id })
              .from(pages)
              .where(and(eq(pages.id, p.parentPageId), isNull(pages.deletedAt)))
              .get();
          return entry(
            'page',
            p,
            p.title,
            [...sectionPlace(section), section?.isInbox ? 'Inbox' : (section?.name ?? '')],
            alive(section) && parentAlive,
          );
        }),
    ];
    entries.sort((a, b) => b.deletedAt - a.deletedAt);
    return { entries, days: Math.round(trashMs / (24 * 3_600_000)) };
  }

  /**
   * Restores an item into a new place, for when its own is gone: a page into a section, a
   * section into a notebook (and group), a group into a notebook (and group).
   */
  restoreTo(owner: string, { item, to }: In<typeof restoreToSchema>): TreeChanges {
    return this.tx(() => {
      const table = trashTable(item.type);
      const row = this.orm
        .select({ id: table.id })
        .from(table)
        .where(
          and(eq(table.id, item.id), eq(table.ownerId, owner), eq(table.deletedRootId, item.id)),
        )
        .get();
      if (!row) throw notFound('Not in the recycle bin.');
      const choose = (what: string) =>
        new ApiError(400, 'invalid_request', `Choose ${what} to restore it to.`);
      switch (item.type) {
        case 'notebook':
          break;
        case 'group': {
          if (!to.notebookId) throw choose('a notebook');
          const parentGroupId = to.groupId ?? null;
          const subtree = this.orm
            .select()
            .from(sectionGroups)
            .where(and(eq(sectionGroups.ownerId, owner), eq(sectionGroups.deletedRootId, item.id)))
            .all();
          const height = heightOf(childrenByParent(subtree, groupParent), item.id);
          this.checkGroupParent(owner, to.notebookId, parentGroupId, height);
          this.orm
            .update(sectionGroups)
            .set({ parentGroupId })
            .where(eq(sectionGroups.id, item.id))
            .run();
          for (const t of [sectionGroups, sections]) {
            this.orm
              .update(t)
              .set({ notebookId: to.notebookId })
              .where(and(eq(t.ownerId, owner), eq(t.deletedRootId, item.id)))
              .run();
          }
          break;
        }
        case 'section': {
          if (!to.notebookId) throw choose('a notebook');
          this.liveNotebook(owner, to.notebookId);
          const groupId = to.groupId ?? null;
          if (groupId !== null && this.liveGroup(owner, groupId).notebookId !== to.notebookId) {
            throw invalidMove('That group is in another notebook.');
          }
          this.orm
            .update(sections)
            .set({ notebookId: to.notebookId, groupId })
            .where(eq(sections.id, item.id))
            .run();
          break;
        }
        case 'page': {
          if (!to.sectionId) throw choose('a section');
          this.liveSection(owner, to.sectionId);
          this.orm.update(pages).set({ parentPageId: null }).where(eq(pages.id, item.id)).run();
          this.orm
            .update(pages)
            .set({ sectionId: to.sectionId })
            .where(and(eq(pages.ownerId, owner), eq(pages.deletedRootId, item.id)))
            .run();
          break;
        }
      }
      return this.restore(owner, [item]);
    });
  }

  /** Deletes items from the recycle bin for good, with everything deleted along with them. */
  deleteForever(owner: string, items: readonly TrashItem[]): PurgeResult {
    return this.tx(() => {
      for (const item of items) {
        const table = trashTable(item.type);
        const found = this.orm
          .select({ id: table.id })
          .from(table)
          .where(
            and(eq(table.id, item.id), eq(table.ownerId, owner), eq(table.deletedRootId, item.id)),
          )
          .get();
        if (!found) throw notFound('Not in the recycle bin.');
      }
      return { removed: this.purgeRoots(owner, items) };
    });
  }

  /** Empties the user's recycle bin. */
  emptyTrash(owner: string): PurgeResult {
    return this.tx(() => ({ removed: this.purgeRoots(owner, this.trashRoots(owner, null)) }));
  }

  /**
   * Deletes for good what has been in any user's recycle bin since before `before`. Answers
   * the users whose bins changed, and how many rows went.
   */
  purgeExpired(before: number): { owners: string[]; removed: number } {
    return this.tx(() => {
      const owners = new Set<string>();
      let removed = 0;
      const byOwner = new Map<string, TrashItem[]>();
      for (const type of ['notebook', 'group', 'section', 'page'] as const) {
        const table = trashTable(type);
        for (const r of this.orm
          .select({ id: table.id, ownerId: table.ownerId })
          .from(table)
          .where(and(eq(table.deletedRootId, table.id), sql`${table.deletedAt} < ${before}`))
          .all()) {
          let list = byOwner.get(r.ownerId);
          if (!list) byOwner.set(r.ownerId, (list = []));
          list.push({ type, id: r.id });
        }
      }
      for (const [owner, items] of byOwner) {
        owners.add(owner);
        removed += this.purgeRoots(owner, items);
      }
      return { owners: [...owners], removed };
    });
  }

  private trashRoots(owner: string, before: number | null): TrashItem[] {
    return (['notebook', 'group', 'section', 'page'] as const).flatMap((type) => {
      const table = trashTable(type);
      return this.orm
        .select({ id: table.id })
        .from(table)
        .where(
          and(
            eq(table.ownerId, owner),
            eq(table.deletedRootId, table.id),
            before === null ? undefined : sql`${table.deletedAt} < ${before}`,
          ),
        )
        .all()
        .map((r) => ({ type, id: r.id }));
    });
  }

  /** Deletes trash roots; the database's cascades take their contents and page versions. */
  private purgeRoots(owner: string, items: readonly TrashItem[]): number {
    let removed = 0;
    // Pages first: a notebook deleted later takes the rest along anyway.
    const rank = { page: 0, section: 1, group: 2, notebook: 3 } as const;
    for (const item of [...items].sort((a, b) => rank[a.type] - rank[b.type])) {
      for (const t of [pages, sections, sectionGroups, notebooks]) {
        removed += this.orm
          .select({ n: sql<number>`count(*)` })
          .from(t)
          .where(and(eq(t.ownerId, owner), eq(t.deletedRootId, item.id)))
          .get()!.n;
      }
      const table = trashTable(item.type);
      this.orm
        .delete(table)
        .where(and(eq(table.id, item.id), eq(table.ownerId, owner)))
        .run();
    }
    return removed;
  }
}

/** The selected pages that aren't inside another selected page (those go along with it). */
function topmost(selected: readonly PageNode[], byId: ReadonlyMap<string, PageNode>): PageNode[] {
  return selected.filter(
    (p) => !selected.some((o) => o.id !== p.id && isWithin(byId, p.parentPageId, o.id, pageParent)),
  );
}

const trashTable = (type: TrashItem['type']) =>
  ({ notebook: notebooks, group: sectionGroups, section: sections, page: pages })[type];

function fail(error: Error): never {
  throw error;
}
