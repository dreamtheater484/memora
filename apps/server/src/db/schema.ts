import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

// Conventions (§7): UUIDv7 primary keys, UTC epoch milliseconds, foreign keys enforced.

/** Instance-level facts: the instance id, the version that created the database, … */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Always lowercase, so the unique constraint is case-insensitive. */
    username: text('username').notNull().unique(),
    displayName: text('display_name').notNull(),
    /** PHC string: `$argon2id$v=19$m=…,t=…,p=…$salt$hash`. */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'user'] })
      .notNull()
      .default('user'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** Two-step verification (Phase 12): the secret, sealed with the instance's key. */
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
    /** The time step of the last code used: each code works once. */
    totpLastStep: integer('totp_last_step'),
    disabledAt: integer('disabled_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('users_username_lowercase', sql`${t.username} = lower(${t.username})`),
    check('users_role_valid', sql`${t.role} IN ('admin', 'user')`),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    /** "Remember this device": a persistent cookie and the longer idle timeout. */
    remember: integer('remember', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    /** Idle expiry: moves forward while the session is used. */
    expiresAt: integer('expires_at').notNull(),
    /** Absolute expiry: never moves. */
    absoluteExpiresAt: integer('absolute_expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    deviceLabel: text('device_label').notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

/** Two-step verification's recovery codes: each works once, instead of a code from the app. */
export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: integer('used_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('recovery_codes_user_id_idx').on(t.userId)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    /** Who did it. Kept (as null) when that user is deleted; `username` keeps the name. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    username: text('username'),
    event: text('event').notNull(),
    metaJson: text('meta_json').notNull().default('{}'),
    ip: text('ip'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_user_id_idx').on(t.userId),
  ],
);

/** Per-user preferences and UI state (§9.2, §9.16), one JSON value per key. */
export const userSettings = sqliteTable(
  'user_settings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/*
 * Notes (§7.2). Every row carries its owner, so each query filters on it directly.
 * Deleting is soft: the row and everything under it get `deleted_at`, and `deleted_root_id`
 * names the item that was deleted, so restoring that item brings back exactly what went with it.
 */

const ownerId = () =>
  text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

const lifecycle = () => ({
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  deletedRootId: text('deleted_root_id'),
});

export const notebooks = sqliteTable(
  'notebooks',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    icon: text('icon').notNull(),
    sortKey: text('sort_key').notNull(),
    ...lifecycle(),
  },
  (t) => [index('notebooks_owner_id_idx').on(t.ownerId)],
);

export const sectionGroups = sqliteTable(
  'section_groups',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    notebookId: text('notebook_id')
      .notNull()
      .references(() => notebooks.id, { onDelete: 'cascade' }),
    parentGroupId: text('parent_group_id').references((): AnySQLiteColumn => sectionGroups.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    sortKey: text('sort_key').notNull(),
    ...lifecycle(),
  },
  (t) => [
    index('section_groups_owner_id_idx').on(t.ownerId),
    index('section_groups_notebook_id_idx').on(t.notebookId),
    index('section_groups_parent_group_id_idx').on(t.parentGroupId),
  ],
);

export const sections = sqliteTable(
  'sections',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    /** Null only for the inbox, which sits outside the notebooks. */
    notebookId: text('notebook_id').references(() => notebooks.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => sectionGroups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    sortKey: text('sort_key').notNull(),
    isInbox: integer('is_inbox', { mode: 'boolean' }).notNull().default(false),
    ...lifecycle(),
  },
  (t) => [
    index('sections_owner_id_idx').on(t.ownerId),
    index('sections_notebook_id_idx').on(t.notebookId),
    index('sections_group_id_idx').on(t.groupId),
    uniqueIndex('sections_one_inbox_per_owner')
      .on(t.ownerId)
      .where(sql`${t.isInbox} = 1`),
    check(
      'sections_inbox_outside_notebooks',
      sql`(${t.isInbox} = 1 AND ${t.notebookId} IS NULL AND ${t.groupId} IS NULL) OR (${t.isInbox} = 0 AND ${t.notebookId} IS NOT NULL)`,
    ),
  ],
);

export const pages = sqliteTable(
  'pages',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    sectionId: text('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    parentPageId: text('parent_page_id').references((): AnySQLiteColumn => pages.id, {
      onDelete: 'cascade',
    }),
    title: text('title').notNull(),
    type: text('type', { enum: ['markdown', 'rich'] }).notNull(),
    /** Markdown text, or the rich editor's document as JSON. */
    content: text('content').notNull(),
    /** Plain text of the content, for snippets and (later) search. */
    contentText: text('content_text').notNull(),
    revision: integer('revision').notNull().default(1),
    sortKey: text('sort_key').notNull(),
    viewMode: text('view_mode', { enum: ['source', 'split', 'preview'] }),
    ...lifecycle(),
  },
  (t) => [
    index('pages_owner_id_idx').on(t.ownerId),
    index('pages_section_id_idx').on(t.sectionId),
    index('pages_parent_page_id_idx').on(t.parentPageId),
    check('pages_type_valid', sql`${t.type} IN ('markdown', 'rich')`),
  ],
);

/**
 * Earlier states of a page (§7.2, §9.7): kept on the server when a save replaces content that
 * hasn't been kept for a while, and the browser's side of a conflict it couldn't merge.
 */
export const pageVersions = sqliteTable(
  'page_versions',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /** The page revision this content had, or started from (a conflict copy). */
    revision: integer('revision').notNull(),
    type: text('type', { enum: ['markdown', 'rich'] }).notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    reason: text('reason', {
      enum: ['auto', 'conversion', 'import', 'restore', 'conflict', 'manual'],
    }).notNull(),
    /** A name given to the version (§9.7); named versions are always kept. */
    name: text('name'),
    deviceLabel: text('device_label').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('page_versions_owner_id_idx').on(t.ownerId),
    index('page_versions_page_id_created_at_idx').on(t.pageId, t.createdAt),
  ],
);

/**
 * Files in pages (§7.3, §9.5): one row per id a page refers to (`asset:<id>`), made by the
 * browser so a file pasted offline already has its place in the text. The bytes live in
 * `asset_blobs`, once per user and content, so the same screenshot pasted twice is stored once.
 */
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    width: integer('width'),
    height: integer('height'),
    originalName: text('original_name').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('assets_owner_id_sha256_idx').on(t.ownerId, t.sha256)],
);

export const assetBlobs = sqliteTable(
  'asset_blobs',
  {
    ownerId: ownerId(),
    sha256: text('sha256').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerId, t.sha256] })],
);

/** Tags (§7.2, §9.9): names are unique per user whatever their case (`name_key`). */
export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    color: text('color'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [uniqueIndex('tags_owner_id_name_key_idx').on(t.ownerId, t.nameKey)],
);

export const pageTags = sqliteTable(
  'page_tags',
  {
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.pageId, t.tagId] }), index('page_tags_tag_id_idx').on(t.tagId)],
);

/**
 * Links between pages (§7.2, §9.9), rebuilt on every save: which titles a page links to. A
 * link is resolved by title when read, so backlinks follow renames and new pages.
 */
export const pageLinks = sqliteTable(
  'page_links',
  {
    sourcePageId: text('source_page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    /** The linked title as written. */
    targetTitle: text('target_title').notNull(),
    /** The same, as titles are compared (`titleKey`). */
    targetKey: text('target_key').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sourcePageId, t.targetKey] }),
    index('page_links_target_key_idx').on(t.targetKey),
  ],
);

/** Templates saved by users (§7.2, §9.9); the built-in ones live in the code. */
export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    name: text('name').notNull(),
    type: text('type', { enum: ['markdown', 'rich'] }).notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('templates_owner_id_idx').on(t.ownerId)],
);

/**
 * The search index's row for each page (§7.5): `fts_pages` (made in the migration, with the
 * triggers that keep it current) is keyed by `docid`, a stable integer the pages table lacks.
 */
export const pageSearch = sqliteTable('page_search', {
  docid: integer('docid').primaryKey({ autoIncrement: true }),
  pageId: text('page_id').notNull().unique(),
});

/*
 * Kanban (§7.4, §9.11). Projects hold boards, boards hold columns and swimlanes, columns hold
 * cards. Everything carries its owner, like the notes. Deleting is for good (archiving is the
 * soft way), so the rows cascade from their parents.
 */

const stamps = () => ({
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    name: text('name').notNull(),
    /** Card keys start with it (`WEB-42`); unique per user. */
    key: text('key').notNull(),
    color: text('color').notNull(),
    icon: text('icon').notNull(),
    sortKey: text('sort_key').notNull(),
    archivedAt: integer('archived_at'),
    nextCardNumber: integer('next_card_number').notNull().default(1),
    ...stamps(),
  },
  (t) => [uniqueIndex('projects_owner_id_key_idx').on(t.ownerId, t.key)],
);

export const boards = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    sortKey: text('sort_key').notNull(),
    settingsJson: text('settings_json').notNull().default('{}'),
    archivedAt: integer('archived_at'),
    ...stamps(),
  },
  (t) => [index('boards_project_id_idx').on(t.projectId)],
);

export const boardColumns = sqliteTable(
  'board_columns',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    wipLimit: integer('wip_limit'),
    wipStrict: integer('wip_strict', { mode: 'boolean' }).notNull().default(false),
    isDone: integer('is_done', { mode: 'boolean' }).notNull().default(false),
    collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
    sort: text('sort').notNull().default('manual'),
    sortKey: text('sort_key').notNull(),
    archivedAt: integer('archived_at'),
    ...stamps(),
  },
  (t) => [index('board_columns_board_id_idx').on(t.boardId)],
);

export const swimlanes = sqliteTable(
  'swimlanes',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
    sortKey: text('sort_key').notNull(),
    ...stamps(),
  },
  (t) => [index('swimlanes_board_id_idx').on(t.boardId)],
);

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    columnId: text('column_id')
      .notNull()
      .references(() => boardColumns.id, { onDelete: 'cascade' }),
    swimlaneId: text('swimlane_id').references(() => swimlanes.id, { onDelete: 'set null' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    /** Markdown, like a page's. */
    description: text('description').notNull().default(''),
    priority: text('priority').notNull().default('none'),
    startDate: text('start_date'),
    dueDate: text('due_date'),
    coverColor: text('cover_color'),
    /** Reserved for sharing (§17). */
    assigneeId: text('assignee_id'),
    sortKey: text('sort_key').notNull(),
    completedAt: integer('completed_at'),
    archivedAt: integer('archived_at'),
    ...stamps(),
  },
  (t) => [
    index('cards_board_id_idx').on(t.boardId),
    index('cards_column_id_idx').on(t.columnId),
    index('cards_owner_id_idx').on(t.ownerId),
  ],
);

export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('labels_project_id_idx').on(t.projectId)],
);

export const cardLabels = sqliteTable(
  'card_labels',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    labelId: text('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.labelId] }),
    index('card_labels_label_id_idx').on(t.labelId),
  ],
);

export const checklists = sqliteTable(
  'checklists',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sortKey: text('sort_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('checklists_card_id_idx').on(t.cardId)],
);

export const checklistItems = sqliteTable(
  'checklist_items',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    checklistId: text('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    sortKey: text('sort_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('checklist_items_checklist_id_idx').on(t.checklistId)],
);

export const cardComments = sqliteTable(
  'card_comments',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
    editedAt: integer('edited_at'),
  },
  (t) => [index('card_comments_card_id_idx').on(t.cardId)],
);

/** Notes linked to cards (§9.11): many to many. */
export const cardPages = sqliteTable(
  'card_pages',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    pageId: text('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.cardId, t.pageId] }),
    index('card_pages_page_id_idx').on(t.pageId),
  ],
);

export const cardAttachments = sqliteTable(
  'card_attachments',
  {
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    sortKey: text('sort_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.cardId, t.assetId] })],
);

export const cardActivity = sqliteTable(
  'card_activity',
  {
    id: text('id').primaryKey(),
    ownerId: ownerId(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull().default('{}'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('card_activity_card_id_idx').on(t.cardId)],
);

/** The search index's row for each card, like `page_search` (`fts_cards`, made in the migration). */
export const cardSearch = sqliteTable('card_search', {
  docid: integer('docid').primaryKey({ autoIncrement: true }),
  cardId: text('card_id').notNull().unique(),
});

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type NotebookRow = typeof notebooks.$inferSelect;
export type SectionGroupRow = typeof sectionGroups.$inferSelect;
export type SectionRow = typeof sections.$inferSelect;
export type PageRow = typeof pages.$inferSelect;
export type PageVersionRow = typeof pageVersions.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
