import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { z } from 'zod';
import { isUuidV7 } from './ids';

/*
 * Notebooks, section groups, sections and pages (§7.2, §9.2). The server validates every
 * request with these schemas; the web app uses the same types and ordering helpers for its
 * optimistic updates, so both sides agree.
 */

/** The 12 section colours; the web app maps each to an OKLCH hue. */
export const COLOR_IDS = [
  'coral',
  'orange',
  'amber',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'magenta',
  'slate',
] as const;
export type ColorId = (typeof COLOR_IDS)[number];

/** The first colour not in `used`, so sections side by side differ; cycles once all are taken. */
export function pickColor(used: Iterable<string>): ColorId {
  const taken = new Set(used);
  return COLOR_IDS.find((c) => !taken.has(c)) ?? COLOR_IDS[taken.size % COLOR_IDS.length]!;
}

/** Notebook icons, named after their Lucide icons. */
export const NOTEBOOK_ICONS = [
  'notebook',
  'book-open',
  'briefcase',
  'house',
  'heart',
  'star',
  'graduation-cap',
  'code',
  'flask-conical',
  'plane',
  'utensils',
  'music',
  'camera',
  'leaf',
  'lightbulb',
  'wallet',
] as const;
export type NotebookIcon = (typeof NOTEBOOK_ICONS)[number];

export const PAGE_TYPES = ['markdown', 'rich'] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const VIEW_MODES = ['source', 'split', 'preview'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/** Pages, subpages and sub-subpages (§9.2). */
export const MAX_PAGE_DEPTH = 3;
/** Section groups inside section groups, counting the outermost as 1. */
export const MAX_GROUP_DEPTH = 4;
/** Pages moved, copied or deleted in one request (a multi-selection). */
export const MAX_BATCH = 500;
/** Content sent when creating a page (quick notes); editing arrives with the editors. */
export const MAX_INITIAL_CONTENT = 100_000;
export const SNIPPET_LENGTH = 140;
export const INBOX_NAME = 'Inbox';
export const UNTITLED = 'Untitled page';

// Ordering

/**
 * Sort keys are fractional indexes: strings that sort between any two others, so moving an
 * item changes only that item. Compare them with `<`, never `localeCompare`: the order is
 * by code unit, the same as SQLite's default text order.
 */
export const keyBetween = (before: string | null, after: string | null): string =>
  generateKeyBetween(before, after);

export const keysBetween = (before: string | null, after: string | null, n: number): string[] =>
  generateNKeysBetween(before, after, n);

export const bySortKey = <T extends { sortKey: string; id: string }>(a: T, b: T): number =>
  a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.id < b.id ? -1 : 1;

// Entities

export interface Notebook {
  id: string;
  name: string;
  color: ColorId;
  icon: NotebookIcon;
  sortKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface SectionGroup {
  id: string;
  notebookId: string;
  parentGroupId: string | null;
  name: string;
  sortKey: string;
  createdAt: number;
  updatedAt: number;
}

export interface Section {
  id: string;
  /** Null only for the inbox, which belongs to no notebook. */
  notebookId: string | null;
  groupId: string | null;
  name: string;
  color: ColorId;
  sortKey: string;
  isInbox: boolean;
  createdAt: number;
  updatedAt: number;
}

/** What the page list needs: everything but the content. */
export interface PageMeta {
  id: string;
  sectionId: string;
  parentPageId: string | null;
  title: string;
  type: PageType;
  sortKey: string;
  /** The start of the page's text, for the page list. */
  snippet: string;
  /** Goes up with every content save; tells a browser whether its copy is current. */
  revision: number;
  /** How the page was last shown (Markdown: source, split or preview); null for the default. */
  viewMode?: ViewMode | null;
  createdAt: number;
  updatedAt: number;
}

export interface Page extends PageMeta {
  /** Markdown text, or the rich editor's document as JSON. */
  content: string;
}

/** `GET /api/v1/tree`: everything the app needs to start, in one request. */
export interface Tree {
  notebooks: Notebook[];
  groups: SectionGroup[];
  sections: Section[];
  pages: PageMeta[];
  inboxId: string;
}

/** Rows a change created or updated; the web app merges them into its copy of the tree. */
export interface TreeChanges {
  notebooks?: Notebook[];
  groups?: SectionGroup[];
  sections?: Section[];
  pages?: PageMeta[];
}

export const TRASH_TYPES = ['notebook', 'group', 'section', 'page'] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

export interface TrashItem {
  type: TrashType;
  id: string;
}

/** Answer to a delete: what went to the recycle bin, so the app can offer Undo. */
export interface DeleteResponse {
  deleted: TrashItem[];
}

// Requests

export const idSchema = z.string().refine(isUuidV7, 'Not a valid id.');
const optionalId = idSchema.nullable().default(null);

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(100, 'Use at most 100 characters.');

export const titleSchema = z.string().trim().max(200, 'Use at most 200 characters.');

const colorSchema = z.enum(COLOR_IDS);

/** Where to put an item among its new siblings: before `beforeId`, or last when null. */
const placement = { beforeId: optionalId };

export const createNotebookSchema = z.object({
  name: nameSchema,
  color: colorSchema,
  icon: z.enum(NOTEBOOK_ICONS).default('notebook'),
});
export type CreateNotebookRequest = z.input<typeof createNotebookSchema>;

export const updateNotebookSchema = z
  .object({ name: nameSchema, color: colorSchema, icon: z.enum(NOTEBOOK_ICONS) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateNotebookRequest = z.input<typeof updateNotebookSchema>;

export const moveNotebookSchema = z.object(placement);
export type MoveNotebookRequest = z.input<typeof moveNotebookSchema>;

export const createGroupSchema = z.object({
  notebookId: idSchema,
  parentGroupId: optionalId,
  name: nameSchema,
});
export type CreateGroupRequest = z.input<typeof createGroupSchema>;

export const updateGroupSchema = z.object({ name: nameSchema });
export type UpdateGroupRequest = z.input<typeof updateGroupSchema>;

export const moveGroupSchema = z.object({
  notebookId: idSchema,
  parentGroupId: optionalId,
  ...placement,
});
export type MoveGroupRequest = z.input<typeof moveGroupSchema>;

export const createSectionSchema = z.object({
  notebookId: idSchema,
  groupId: optionalId,
  name: nameSchema,
  color: colorSchema,
});
export type CreateSectionRequest = z.input<typeof createSectionSchema>;

export const updateSectionSchema = z
  .object({ name: nameSchema, color: colorSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateSectionRequest = z.input<typeof updateSectionSchema>;

export const moveSectionSchema = z.object({
  notebookId: idSchema,
  groupId: optionalId,
  ...placement,
});
export type MoveSectionRequest = z.input<typeof moveSectionSchema>;

export const createPageSchema = z
  .object({
    /** Made by the browser, so a page created offline keeps its id when it syncs (D14). */
    id: idSchema.optional(),
    sectionId: idSchema,
    parentPageId: optionalId,
    title: titleSchema.default(''),
    type: z.enum(PAGE_TYPES).default('markdown'),
    /** Initial Markdown text, for quick notes. */
    content: z.string().max(MAX_INITIAL_CONTENT).default(''),
    ...placement,
  })
  .refine((v) => v.type === 'markdown' || v.content === '', {
    message: 'Only Markdown pages start with text.',
    path: ['content'],
  });
export type CreatePageRequest = z.input<typeof createPageSchema>;

export const updatePageSchema = z
  .object({ title: titleSchema, viewMode: z.enum(VIEW_MODES) })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdatePageRequest = z.input<typeof updatePageSchema>;

const pageIds = z
  .array(idSchema)
  .min(1)
  .max(MAX_BATCH)
  .refine((ids) => new Set(ids).size === ids.length, 'Each page only once.');

/** Moves or copies pages (with their subpages) to one place, keeping their order. */
export const placePagesSchema = z.object({
  ids: pageIds,
  sectionId: idSchema,
  parentPageId: optionalId,
  ...placement,
});
export type PlacePagesRequest = z.input<typeof placePagesSchema>;

export const deletePagesSchema = z.object({ ids: pageIds });
export type DeletePagesRequest = z.input<typeof deletePagesSchema>;

export const restoreSchema = z.object({
  items: z
    .array(z.object({ type: z.enum(TRASH_TYPES), id: idSchema }))
    .min(1)
    .max(MAX_BATCH),
});
export type RestoreRequest = z.input<typeof restoreSchema>;

// Per-user UI state (§9.2): kept on the server, so another device picks up where you left off.

export const PAGE_LIST_SIDES = ['left', 'right'] as const;

export const uiStateSchema = z
  .object({
    lastSectionId: idSchema.nullable(),
    /** The page last open in each section. */
    lastPages: z.record(idSchema, idSchema).refine((v) => Object.keys(v).length <= 1000),
    /** Expanded notebooks and section groups in the navigation. */
    expanded: z.array(idSchema).max(2000),
    pageListSide: z.enum(PAGE_LIST_SIDES),
  })
  .partial();
export type UiState = z.infer<typeof uiStateSchema>;

/** How the Markdown editor behaves (§9.16, Editing); unset fields take the defaults below. */
export const editorSettingsSchema = z
  .object({
    /** The view a Markdown page opens in until it has one of its own. */
    viewMode: z.enum(VIEW_MODES),
    lineNumbers: z.boolean(),
    wordWrap: z.boolean(),
    /** The browser's own spellcheck. */
    spellcheck: z.boolean(),
    tabSize: z.number().int().min(1).max(8),
    whitespace: z.boolean(),
    /** Small previews of images under their `![]()` lines in the source. */
    imageThumbnails: z.boolean(),
    /** Tables line up while you type in them. */
    formatTables: z.boolean(),
    /** Every table on the page lines up when you press Ctrl/Cmd+S. */
    formatTablesOnSave: z.boolean(),
  })
  .partial();
export type EditorSettings = z.infer<typeof editorSettingsSchema>;

export const DEFAULT_EDITOR_SETTINGS: Required<EditorSettings> = {
  viewMode: 'split',
  lineNumbers: false,
  wordWrap: true,
  spellcheck: true,
  tabSize: 4,
  whitespace: false,
  imageThumbnails: true,
  formatTables: true,
  formatTablesOnSave: false,
};

export interface Settings {
  ui: UiState;
  editor: EditorSettings;
}

export const updateSettingsSchema = z
  .object({ ui: uiStateSchema, editor: editorSettingsSchema })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateSettingsRequest = z.input<typeof updateSettingsSchema>;
