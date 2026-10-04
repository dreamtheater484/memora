import { z } from 'zod';
import type { SyncStatus, SyncedPart } from './cloudSync';
import type { Job } from './transfer';
import { PAGE_TYPES, idSchema, type PageMeta, type PageType, type TreeChanges } from './notes';

/*
 * Saving page content and the live event channel (§9.6, §10).
 *
 * A save names the revision it started from. The server takes it only if that is still the
 * page's revision; otherwise it answers `revision_conflict` with its own content, and the
 * browser, which kept the version both edits started from, merges the two (D9).
 */

/** Largest page content accepted, in characters: far above the 200 KB budget of §14. */
export const MAX_CONTENT = 2_000_000;

export const saveContentSchema = z.object({
  baseRevision: z.number().int().min(1),
  content: z.string().max(MAX_CONTENT),
  /**
   * Set when this save settles a conflict ("Keep mine", Compare): the content it replaces is
   * kept as a version first, however recent the last one is (§9.7).
   */
  resolving: z.boolean().optional(),
});
export type SaveContentRequest = z.input<typeof saveContentSchema>;

/** `PUT /pages/:id/content`: the new revision, and the page's changed row for the tree. */
export interface ContentSaved extends TreeChanges {
  revision: number;
  pages: [PageMeta];
}

/**
 * `POST /pages/:id/convert` (§9.4): the page becomes the other type, with its content converted
 * by the browser. The server keeps the old content as a version first.
 */
export const convertPageSchema = z.object({
  type: z.enum(PAGE_TYPES),
  content: z.string().max(MAX_CONTENT),
  baseRevision: z.number().int().min(1),
});
export type ConvertPageRequest = z.input<typeof convertPageSchema>;

/** `details` of a `revision_conflict` error: what the server has now. */
export interface ContentConflict {
  revision: number;
  content: string;
  type: PageType;
}

// Versions (§9.7). Phase 4 keeps conflict copies; history and manual versions come in Phase 7.

export const VERSION_REASONS = [
  'auto',
  'conversion',
  'import',
  'restore',
  'conflict',
  'manual',
] as const;
export type VersionReason = (typeof VERSION_REASONS)[number];

/** Longest version name. */
export const MAX_VERSION_NAME = 100;

const versionName = z.string().trim().min(1).max(MAX_VERSION_NAME);

/**
 * `POST /pages/:id/versions`: the browser's side of a conflict it couldn't merge (with its
 * content), a version saved by hand ("Save version…", optionally named), or a snapshot taken
 * as a page that was edited is closed (§9.7). The last two keep the page's current content,
 * and nothing when it is the same as the latest version's.
 */
export const createVersionSchema = z.discriminatedUnion('reason', [
  z.object({
    reason: z.literal('conflict'),
    content: z.string().max(MAX_CONTENT),
    /** The revision the kept content started from. */
    baseRevision: z.number().int().min(1),
  }),
  z.object({ reason: z.literal('manual'), name: versionName.optional() }),
  z.object({ reason: z.literal('auto') }),
]);
export type CreateVersionRequest = z.input<typeof createVersionSchema>;

/** `PATCH /pages/:id/versions/:vid`: names a version, or takes its name away. */
export const nameVersionSchema = z.object({ name: versionName.nullable() });
export type NameVersionRequest = z.input<typeof nameVersionSchema>;

export interface PageVersionMeta {
  id: string;
  pageId: string;
  revision: number;
  reason: VersionReason;
  /** Given by hand; named versions are never thinned out. */
  name: string | null;
  type: PageType;
  /** Length of the content, in characters. */
  size: number;
  deviceLabel: string;
  createdAt: number;
}

/** `GET /pages/:id/versions/:vid`: a version with its content. */
export interface PageVersion extends PageVersionMeta {
  title: string;
  content: string;
}

/** `POST /pages/:id/versions` answers the version kept, or null when nothing changed. */
export interface VersionKept {
  version: PageVersionMeta | null;
}

// Live events (`/api/v1/events`, a WebSocket). The server only sends a user their own events.

/** Header naming the browser that makes a request, so its own changes aren't echoed back. */
export const DEVICE_HEADER = 'x-memora-device';
/** A browser's id: made once per browser and kept in local storage. */
export const deviceIdSchema = z.string().regex(/^[\w-]{8,64}$/);

/** Other signed-in browsers of the same user, with the pages they have open. */
export interface PresenceDevice {
  label: string;
  pages: string[];
}

export type ServerEvent =
  /** Sent first: the id of the server's data, new after a backup is restored. */
  | { type: 'hello'; dataId: string }
  /** Notebooks, groups, sections or pages changed: reload the tree. */
  | { type: 'tree.changed'; origin: string | null }
  /** A page's content was saved. */
  | { type: 'page.updated'; page: PageMeta; revision: number; origin: string | null }
  | { type: 'presence'; devices: PresenceDevice[] }
  /** An import or export moved on (§9.10). */
  | { type: 'job.updated'; job: Job }
  /** Projects or boards were added, renamed, reordered, archived or deleted (§9.11). */
  | { type: 'projects.changed'; origin: string | null }
  /** Something on a board changed; `cardId` when it was one card. */
  | { type: 'board.changed'; boardId: string; cardId?: string; origin: string | null }
  /** Sync through a cloud folder (the desktop app) started, finished or failed a run. */
  | { type: 'sync.status'; status: SyncStatus }
  /** Sync brought in changes from other computers: reload these parts. */
  | { type: 'synced'; parts: SyncedPart[] };

/** Most pages one browser reports as open. */
export const MAX_PRESENCE_PAGES = 50;

export const clientEventSchema = z.object({
  type: z.literal('presence'),
  pages: z.array(idSchema).max(MAX_PRESENCE_PAGES),
});
export type ClientEvent = z.input<typeof clientEventSchema>;
