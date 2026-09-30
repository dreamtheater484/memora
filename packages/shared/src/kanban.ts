import { z } from 'zod';
import { COLOR_IDS, idSchema, nameSchema, type ColorId } from './notes';

/*
 * Kanban (§7.4, §9.11): projects hold boards, boards hold columns (and optional swimlanes),
 * columns hold cards. Cards have a key made of the project's key and a number (`WEB-42`),
 * labels shared across the project's boards, checklists, comments, files, linked notes and
 * an activity log.
 */

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PROJECT_ICONS = [
  'square-kanban',
  'rocket',
  'code',
  'palette',
  'megaphone',
  'briefcase',
  'house',
  'leaf',
  'graduation-cap',
  'wrench',
  'heart',
  'star',
] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];

export const BOARD_TEMPLATES = ['basic', 'extended', 'empty'] as const;
export type BoardTemplate = (typeof BOARD_TEMPLATES)[number];

/** The columns each board template starts with; the last is the Done column. */
export const BOARD_TEMPLATE_COLUMNS: Record<BoardTemplate, string[]> = {
  basic: ['To do', 'Doing', 'Done'],
  extended: ['Backlog', 'To do', 'In progress', 'Review', 'Done'],
  empty: [],
};

export const COLUMN_SORTS = ['manual', 'due', 'priority', 'created'] as const;
export type ColumnSort = (typeof COLUMN_SORTS)[number];

/** How a board groups its cards into rows. */
export const LANE_MODES = ['none', 'custom', 'priority', 'label'] as const;
export type LaneMode = (typeof LANE_MODES)[number];

export const MAX_CARD_TITLE = 300;
export const MAX_CARD_DESCRIPTION = 100_000;
export const MAX_COMMENT = 20_000;
export const MAX_WIP = 999;

/** Card keys, as notes mention them: `WEB-42`. */
export const CARD_KEY = /\b([A-Z][A-Z0-9]{1,9})-([1-9]\d{0,8})\b/g;
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Use 2 to 10 letters or digits, starting with a letter.');

/** A key suggested from a project's name: its initials, or its first letters. */
export function suggestKey(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const initials = words.map((w) => w[0]!).join('');
  const key = (initials.length >= 2 ? initials : (words[0] ?? '')).toUpperCase().slice(0, 4);
  const clean = key.replace(/^[0-9]+/, '');
  return clean.length >= 2 ? clean : 'PRJ';
}

// Entities

export interface Project {
  id: string;
  name: string;
  key: string;
  color: ColorId;
  icon: ProjectIcon;
  sortKey: string;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface BoardSettings {
  lanes: LaneMode;
  /** Card face details that can be hidden. */
  hide?: ('labels' | 'dates' | 'checklist' | 'counts')[];
}

export interface Board {
  id: string;
  projectId: string;
  name: string;
  description: string;
  sortKey: string;
  settings: BoardSettings;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: ColorId;
}

export interface Column {
  id: string;
  boardId: string;
  name: string;
  color: ColorId | null;
  wipLimit: number | null;
  /** Strict: a full column takes no more cards. Otherwise it warns. */
  wipStrict: boolean;
  /** Cards moved here are completed. */
  isDone: boolean;
  collapsed: boolean;
  sort: ColumnSort;
  sortKey: string;
  archivedAt: number | null;
}

export interface Swimlane {
  id: string;
  boardId: string;
  name: string;
  color: ColorId | null;
  collapsed: boolean;
  sortKey: string;
}

/** What a card's face shows. */
export interface Card {
  id: string;
  boardId: string;
  columnId: string;
  swimlaneId: string | null;
  number: number;
  title: string;
  priority: Priority;
  /** Dates as `YYYY-MM-DD`. */
  startDate: string | null;
  dueDate: string | null;
  coverColor: ColorId | null;
  labelIds: string[];
  checklist: { done: number; total: number };
  comments: number;
  attachments: number;
  pages: number;
  sortKey: string;
  completedAt: number | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  done: boolean;
  sortKey: string;
}

export interface Checklist {
  id: string;
  cardId: string;
  title: string;
  sortKey: string;
  items: ChecklistItem[];
}

export interface CardComment {
  id: string;
  cardId: string;
  userId: string | null;
  author: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
}

export interface CardAttachment {
  assetId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}

/** A note linked to a card; `deleted` when it is in the recycle bin. */
export interface CardPage {
  pageId: string;
  title: string;
  sectionId: string;
  type: 'markdown' | 'rich';
  deleted: boolean;
}

export const ACTIVITY_TYPES = [
  'created',
  'moved',
  'renamed',
  'described',
  'priority_changed',
  'dates_changed',
  'labels_changed',
  'completed',
  'reopened',
  'archived',
  'restored',
  'note_linked',
  'note_unlinked',
  'commented',
  'attached',
  'duplicated',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface CardActivity {
  id: string;
  type: ActivityType;
  /** What changed, for the log: column names, the old title, a note's title, … */
  payload: Record<string, unknown>;
  author: string;
  createdAt: number;
}

export interface CardDetail {
  card: Card;
  key: string;
  description: string;
  checklists: Checklist[];
  comments: CardComment[];
  attachments: CardAttachment[];
  pages: CardPage[];
  activity: CardActivity[];
}

/** `GET /projects`: the projects and boards, for the navigation. */
export interface Projects {
  projects: Project[];
  boards: Board[];
  labels: Label[];
}

/** `GET /boards/:id`: everything a board shows. */
export interface BoardData {
  board: Board;
  project: Project;
  labels: Label[];
  columns: Column[];
  swimlanes: Swimlane[];
  cards: Card[];
}

/** A card linked to a note, as the note's panel lists it. */
export interface LinkedCard {
  id: string;
  key: string;
  title: string;
  boardId: string;
  boardName: string;
  columnName: string;
  completedAt: number | null;
  archivedAt: number | null;
}

// Requests

const colorSchema = z.enum(COLOR_IDS);
const optionalId = idSchema.nullable().default(null);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-30.')
  .nullable();
const titleSchema = z
  .string()
  .trim()
  .min(1, 'Enter a title.')
  .max(MAX_CARD_TITLE, `Use at most ${MAX_CARD_TITLE} characters.`);

export const createProjectSchema = z.object({
  name: nameSchema,
  key: projectKeySchema,
  color: colorSchema,
  icon: z.enum(PROJECT_ICONS).default('square-kanban'),
  /** The first board's columns. */
  template: z.enum(BOARD_TEMPLATES).default('basic'),
});
export type CreateProjectRequest = z.input<typeof createProjectSchema>;

export const updateProjectSchema = z
  .object({
    name: nameSchema,
    key: projectKeySchema,
    color: colorSchema,
    icon: z.enum(PROJECT_ICONS),
    archived: z.boolean(),
    beforeId: optionalId,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateProjectRequest = z.input<typeof updateProjectSchema>;

export const createBoardSchema = z.object({
  projectId: idSchema,
  name: nameSchema,
  template: z.enum(BOARD_TEMPLATES).default('basic'),
});
export type CreateBoardRequest = z.input<typeof createBoardSchema>;

export const updateBoardSchema = z
  .object({
    name: nameSchema,
    description: z.string().max(2000),
    lanes: z.enum(LANE_MODES),
    archived: z.boolean(),
    beforeId: optionalId,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateBoardRequest = z.input<typeof updateBoardSchema>;

export const createColumnSchema = z.object({
  name: nameSchema,
  beforeId: optionalId,
});
export type CreateColumnRequest = z.input<typeof createColumnSchema>;

export const updateColumnSchema = z
  .object({
    name: nameSchema,
    color: colorSchema.nullable(),
    wipLimit: z.number().int().min(1).max(MAX_WIP).nullable(),
    wipStrict: z.boolean(),
    isDone: z.boolean(),
    collapsed: z.boolean(),
    sort: z.enum(COLUMN_SORTS),
    archived: z.boolean(),
    beforeId: optionalId,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateColumnRequest = z.input<typeof updateColumnSchema>;

export const createLaneSchema = z.object({ name: nameSchema, beforeId: optionalId });
export type CreateLaneRequest = z.input<typeof createLaneSchema>;

export const updateLaneSchema = z
  .object({
    name: nameSchema,
    color: colorSchema.nullable(),
    collapsed: z.boolean(),
    beforeId: optionalId,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateLaneRequest = z.input<typeof updateLaneSchema>;

export const createCardSchema = z.object({
  /** Made by the browser, so the card shows before the server answers. */
  id: idSchema.optional(),
  columnId: idSchema,
  swimlaneId: optionalId,
  title: titleSchema,
  /** Before this card, or at the end (null); `top` puts it first. */
  beforeId: optionalId,
  top: z.boolean().default(false),
  /** Linked straight away ("Add to board…" from a note). */
  pageId: idSchema.optional(),
});
export type CreateCardRequest = z.input<typeof createCardSchema>;

export const updateCardSchema = z
  .object({
    title: titleSchema,
    description: z.string().max(MAX_CARD_DESCRIPTION),
    priority: z.enum(PRIORITIES),
    startDate: dateSchema,
    dueDate: dateSchema,
    coverColor: colorSchema.nullable(),
    labelIds: z.array(idSchema).max(20),
    completed: z.boolean(),
    archived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateCardRequest = z.input<typeof updateCardSchema>;

/** `POST /cards/:id/move`: into a column (of this or another board), before a card or last. */
export const moveCardSchema = z.object({
  columnId: idSchema,
  swimlaneId: optionalId,
  beforeId: optionalId,
});
export type MoveCardRequest = z.input<typeof moveCardSchema>;

export const createLabelSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(40),
  color: colorSchema,
});
export type CreateLabelRequest = z.input<typeof createLabelSchema>;

export const updateLabelSchema = createLabelSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');

export const createChecklistSchema = z.object({ title: z.string().trim().min(1).max(200) });
export const updateChecklistSchema = createChecklistSchema;

export const createChecklistItemSchema = z.object({ text: z.string().trim().min(1).max(500) });
export const updateChecklistItemSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    done: z.boolean(),
    checklistId: idSchema,
    beforeId: optionalId,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateChecklistItemRequest = z.input<typeof updateChecklistItemSchema>;

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(MAX_COMMENT),
});

export const attachSchema = z.object({ assetId: idSchema });

// Helpers

export const cardKey = (project: Pick<Project, 'key'>, card: Pick<Card, 'number'>): string =>
  `${project.key}-${card.number}`;

/** Today as `YYYY-MM-DD` in the browser's time zone. */
export function isoDay(time: number): string {
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'none';

/** How close a card's due date is: red when overdue, amber within two days. */
export function dueState(card: Pick<Card, 'dueDate' | 'completedAt'>, now: number): DueState {
  if (!card.dueDate) return 'none';
  if (card.completedAt) return 'later';
  const today = isoDay(now);
  if (card.dueDate < today) return 'overdue';
  if (card.dueDate === today) return 'today';
  return card.dueDate <= isoDay(now + 2 * 86_400_000) ? 'soon' : 'later';
}

export const DUE_FILTERS = ['overdue', 'today', 'week', 'none'] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export interface CardFilter {
  text?: string;
  labelIds?: string[];
  priorities?: Priority[];
  due?: DueFilter;
  /** Only cards with linked notes. */
  linked?: boolean;
  /** Completed cards: shown (undefined), only (true) or hidden (false). */
  completed?: boolean;
}

export const hasFilter = (f: CardFilter): boolean =>
  !!(
    f.text?.trim() ||
    f.labelIds?.length ||
    f.priorities?.length ||
    f.due ||
    f.linked ||
    f.completed !== undefined
  );

/** Whether a card passes a board's filters. */
export function matchesFilter(card: Card, key: string, f: CardFilter, now: number): boolean {
  const text = f.text?.trim().toLowerCase();
  if (text && !card.title.toLowerCase().includes(text) && !key.toLowerCase().includes(text)) {
    return false;
  }
  if (f.labelIds?.length && !f.labelIds.some((id) => card.labelIds.includes(id))) return false;
  if (f.priorities?.length && !f.priorities.includes(card.priority)) return false;
  if (f.linked && card.pages === 0) return false;
  if (f.completed === true && !card.completedAt) return false;
  if (f.completed === false && card.completedAt) return false;
  if (f.due) {
    if (f.due === 'none') return !card.dueDate;
    if (!card.dueDate) return false;
    const today = isoDay(now);
    if (f.due === 'overdue') return card.dueDate < today && !card.completedAt;
    if (f.due === 'today') return card.dueDate === today;
    return card.dueDate >= today && card.dueDate <= isoDay(now + 6 * 86_400_000);
  }
  return true;
}

const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

/** Cards of a column in the order it shows them. */
export function sortCards(cards: Card[], sort: ColumnSort): Card[] {
  const byKey = (a: Card, b: Card) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0);
  const list = [...cards];
  switch (sort) {
    case 'due':
      return list.sort(
        (a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || byKey(a, b),
      );
    case 'priority':
      return list.sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byKey(a, b),
      );
    case 'created':
      return list.sort((a, b) => b.createdAt - a.createdAt || byKey(a, b));
    default:
      return list.sort(byKey);
  }
}

/** Lanes shown when a board groups by priority. */
export const PRIORITY_LANES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none'];
