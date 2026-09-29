import { z } from 'zod';
import { COLOR_IDS, type ColorId } from './notes';

/*
 * Tags (§9.9): chips under a page's title, with an optional colour. A tag exists while a page
 * uses it or until it is deleted; names are unique per user, whatever their case.
 */

/** Longest tag name. */
export const MAX_TAG_NAME = 40;
/** Most tags on one page. */
export const MAX_PAGE_TAGS = 20;

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(MAX_TAG_NAME, `Use at most ${MAX_TAG_NAME} characters.`)
  .regex(/^[^",]+$/, 'Tags can’t contain commas or quotes.');

export interface Tag {
  id: string;
  name: string;
  color: ColorId | null;
  createdAt: number;
}

/** `PUT /pages/:id/tags`: the page's tags by name; new names become new tags. */
export const setPageTagsSchema = z.object({
  names: z.array(tagNameSchema).max(MAX_PAGE_TAGS),
});
export type SetPageTagsRequest = z.input<typeof setPageTagsSchema>;

/** `PATCH /tags/:id` */
export const updateTagSchema = z
  .object({ name: tagNameSchema, color: z.enum(COLOR_IDS).nullable() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');
export type UpdateTagRequest = z.input<typeof updateTagSchema>;

/** The key tag names are compared by. */
export const tagKey = (name: string): string => name.trim().toLowerCase();
