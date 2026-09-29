import { z } from 'zod';
import { TRASH_TYPES, idSchema, type TrashType } from './notes';

/*
 * The recycle bin (§9.7): what was deleted, restoring it (where it was, or somewhere else when
 * that place is gone), deleting it for good, and emptying the bin. Items are purged after a
 * while (`MEMORA_TRASH_DAYS`), and files no page uses any more go with them.
 */

/** Default days before the recycle bin is emptied of an item. */
export const DEFAULT_TRASH_DAYS = 30;

/** One deleted item, with what went with it. */
export interface TrashEntry {
  type: TrashType;
  id: string;
  /** The item's name or title. */
  name: string;
  /** Where it was: notebook, groups and section, as names. */
  location: string[];
  /** Pages deleted with it (itself included, for a page). */
  pages: number;
  deletedAt: number;
  /** When it is purged. */
  purgeAt: number;
  /**
   * Whether it can go back where it was. When its notebook, group, section or parent is gone
   * too, it needs a new place (`POST /trash/restore-to`).
   */
  restorable: boolean;
}

export interface TrashList {
  entries: TrashEntry[];
  /** Days an item stays in the bin. */
  days: number;
}

const trashItem = z.object({ type: z.enum(TRASH_TYPES), id: idSchema });

/**
 * `POST /trash/restore-to`: an item back in a new place. A page goes to a section, a section
 * to a notebook (and a group in it), a group to a notebook. Notebooks always go back.
 */
export const restoreToSchema = z.object({
  item: trashItem,
  to: z.object({
    notebookId: idSchema.optional(),
    groupId: idSchema.nullable().optional(),
    sectionId: idSchema.optional(),
  }),
});
export type RestoreToRequest = z.input<typeof restoreToSchema>;

/** `POST /trash/delete`: deletes items (and what went with them) for good. */
export const deleteForeverSchema = z.object({
  items: z.array(trashItem).min(1).max(500),
});
export type DeleteForeverRequest = z.input<typeof deleteForeverSchema>;

/** Answer to deleting for good or emptying the bin. */
export interface PurgeResult {
  /** Rows removed, all kinds together. */
  removed: number;
}
