import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { z } from 'zod';
import { isUuidV7 } from './ids';
import type { Tag } from './tags';

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
  /** Its tags' ids (§9.9); absent when it has none. */
  tags?: string[];
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
  /** The user's tags (§9.9). */
  tags?: Tag[];
}

/** Rows a change created or updated; the web app merges them into its copy of the tree. */
export interface TreeChanges {
  notebooks?: Notebook[];
  groups?: SectionGroup[];
  sections?: Section[];
  pages?: PageMeta[];
  tags?: Tag[];
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

export const createPageSchema = z.object({
  /** Made by the browser, so a page created offline keeps its id when it syncs (D14). */
  id: idSchema.optional(),
  sectionId: idSchema,
  parentPageId: optionalId,
  title: titleSchema.default(''),
  type: z.enum(PAGE_TYPES).default('markdown'),
  /** Initial content: a quick note's text, or a template (a rich page's document). */
  content: z.string().max(MAX_INITIAL_CONTENT).default(''),
  ...placement,
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

/** What can be a favourite, or a recent item (§9.9). */
export const PLACE_TYPES = ['page', 'section', 'notebook'] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

/** Recent items kept. */
export const MAX_RECENT = 50;
/** Favourites a user may have. */
export const MAX_FAVORITES = 200;

const place = z.object({ type: z.enum(PLACE_TYPES), id: idSchema });
export type Place = z.infer<typeof place>;

/*
 * The workspace on wide screens (§9.12): panes beside the main one, each with tabs. A layout
 * is saved per device class on the device; named layouts follow the user.
 */

/** What a pane's tab shows. */
export const PANE_KINDS = ['page', 'board', 'search', 'backlinks', 'history'] as const;
export type PaneKind = (typeof PANE_KINDS)[number];
/** Panes beside the main one, at most. */
export const MAX_PANES = 3;
/** Tabs in one pane, at most. */
export const MAX_TABS = 12;
/** Named layouts a user may keep. */
export const MAX_LAYOUTS = 20;

export const paneTabSchema = z.object({
  kind: z.enum(PANE_KINDS),
  /** A page or board id, a search; for backlinks and history, null follows the main pane. */
  target: z.string().max(200).nullable(),
});
export type PaneTabSpec = z.infer<typeof paneTabSchema>;

export const workspaceLayoutSchema = z.object({
  name: z.string().trim().min(1).max(40),
  panes: z
    .array(
      z.object({
        tabs: z.array(paneTabSchema).max(MAX_TABS),
        active: z
          .number()
          .int()
          .min(0)
          .max(MAX_TABS - 1),
      }),
    )
    .max(MAX_PANES),
  /** Shares of the width, the main pane first. */
  sizes: z.array(z.number().positive().max(100)).max(MAX_PANES + 1),
});
export type WorkspaceLayout = z.infer<typeof workspaceLayoutSchema>;

/** How close together lines and paragraphs are in a rich page. */
export const RICH_SPACINGS = ['compact', 'comfortable'] as const;
export type RichSpacing = (typeof RICH_SPACINGS)[number];

/** The narrowest a rich page's text can be made, in pixels. */
export const RICH_MIN_WIDTH = 280;

export const uiStateSchema = z
  .object({
    lastSectionId: idSchema.nullable(),
    /** The page last open in each section. */
    lastPages: z.record(idSchema, idSchema).refine((v) => Object.keys(v).length <= 1000),
    /** Expanded notebooks and section groups in the navigation. */
    expanded: z.array(idSchema).max(2000),
    pageListSide: z.enum(PAGE_LIST_SIDES),
    /** Favourites, in the order shown. */
    favorites: z.array(place).max(MAX_FAVORITES),
    /** Recently opened, newest first. */
    recent: z.array(place.extend({ at: z.number().int() })).max(MAX_RECENT),
    /** The template new pages in a section start from, by section (§9.9); null removes it. */
    sectionTemplates: z
      .record(idSchema, z.string().max(64).nullable())
      .refine((v) => Object.keys(v).length <= 1000),
    /** Pages shown at the full width of their pane instead of a readable width (§9.12). */
    fullWidth: z.array(idSchema).max(1000),
    /**
     * The width of a rich page's text in pixels, by page, as its edge was dragged; without
     * one the text fills the pane. null removes a page's.
     */
    pageWidths: z
      .record(idSchema, z.number().int().min(RICH_MIN_WIDTH).max(4000).nullable())
      .refine((v) => Object.keys(v).length <= 1000),
    /** Named workspace layouts ("Writing", "Planning"). */
    layouts: z.array(workspaceLayoutSchema).max(MAX_LAYOUTS),
  })
  .partial();
export type UiState = z.infer<typeof uiStateSchema>;

/** How the Markdown editor behaves (§9.16, Editing); unset fields take the defaults below. */
/** How wide a rich page is shown: filling the pane, or as an A4 or Letter sheet. */
export const PAGE_VIEWS = ['off', 'a4', 'letter'] as const;
export type PageView = (typeof PAGE_VIEWS)[number];

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
    /** Diagrams drawn in place of their code in the source, while the cursor is elsewhere. */
    drawDiagrams: z.boolean(),
    /** Tables line up while you type in them. */
    formatTables: z.boolean(),
    /** Every table on the page lines up when you press Ctrl/Cmd+S. */
    formatTablesOnSave: z.boolean(),
    /** The type of new pages. */
    pageType: z.enum(PAGE_TYPES),
    /** Rich pages shown as a sheet of paper (§9.4), or filling the pane. */
    pageView: z.enum(PAGE_VIEWS),
    /** Large pasted images are made smaller, and photos stored as WebP (§9.5). */
    downscaleImages: z.boolean(),
    /** The longest side, in pixels, of a downscaled image. */
    maxImageEdge: z.number().int().min(640).max(8192),
    /** Markdown text stops at this many characters a line, unless full width (§9.12). */
    lineLength: z.number().int().min(60).max(120),
    /** Rich pages: lines and paragraphs close together as in a notebook, or roomier. */
    richSpacing: z.enum(RICH_SPACINGS),
    /** Rich pages: the font of text without one ('' is Memora's own). */
    richFont: z.string().max(200),
    /** Rich pages: the size, in points, of text without one. */
    richFontSize: z.number().int().min(8).max(72),
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
  drawDiagrams: true,
  formatTables: true,
  formatTablesOnSave: false,
  pageType: 'markdown',
  pageView: 'off',
  downscaleImages: false,
  maxImageEdge: 2560,
  lineLength: 80,
  richSpacing: 'compact',
  richFont: '',
  richFontSize: 11,
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
