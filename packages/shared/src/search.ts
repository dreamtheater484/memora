import { z } from 'zod';
import { PAGE_TYPES, idSchema, type PageType } from './notes';

/*
 * Search (§9.8): full text over titles, text and tags, with filters and a small syntax:
 * `"exact phrase"`, `-exclude`, `tag:work`, `in:"Section name"`. Matches are marked in titles
 * and snippets with MARK_START and MARK_END, never with HTML.
 */

export const MARK_START = '\u0001';
export const MARK_END = '\u0002';

export const MODIFIED_WITHIN = ['day', 'week', 'month', 'year'] as const;
export type ModifiedWithin = (typeof MODIFIED_WITHIN)[number];

/** Most results one search answers. */
export const MAX_SEARCH_RESULTS = 100;

/** `GET /search`: the query and filters (all optional). */
export const searchQuerySchema = z.object({
  q: z.string().max(500).default(''),
  notebookId: idSchema.optional(),
  sectionId: idSchema.optional(),
  tagId: idSchema.optional(),
  type: z.enum(PAGE_TYPES).optional(),
  modified: z.enum(MODIFIED_WITHIN).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).default(50),
});
export type SearchQuery = z.input<typeof searchQuerySchema>;

export interface SearchHit {
  id: string;
  /** The title, with matches marked. */
  title: string;
  /** Text around the matches, marked; the start of the page when only the title matched. */
  snippet: string;
  sectionId: string;
  type: PageType;
  tags: string[];
  updatedAt: number;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** How many pages match in all (at most 1000 are counted). */
  total: number;
}

export interface ParsedSearch {
  /** Words to find (as prefixes: results appear while typing). */
  words: string[];
  /** Exact phrases. */
  phrases: string[];
  /** Words or phrases that must not appear. */
  exclude: string[];
  /** `tag:name`: pages with all of these tags. */
  tags: string[];
  /** `in:name`: pages in a section (or notebook) of that name. */
  within: string[];
}

/** Splits a search into its parts; quotes group words, and a stray quote is ignored. */
export function parseSearch(query: string): ParsedSearch {
  const parsed: ParsedSearch = { words: [], phrases: [], exclude: [], tags: [], within: [] };
  const token = /(-?)(?:(tag|in):)?(?:"([^"]*)"?|(\S+))/gi;
  for (const match of query.matchAll(token)) {
    const [, minus, field, quoted, bare] = match;
    const text = (quoted ?? bare ?? '').replace(/"/g, '').trim();
    if (!text) continue;
    const key = field?.toLowerCase();
    if (key === 'tag') parsed.tags.push(text);
    else if (key === 'in') parsed.within.push(text);
    else if (minus) parsed.exclude.push(text);
    else if (quoted !== undefined) parsed.phrases.push(text);
    else parsed.words.push(text);
  }
  return parsed;
}

/** Splits marked text into plain and matched parts, for highlighting. */
export function markedParts(text: string): { text: string; match: boolean }[] {
  const parts: { text: string; match: boolean }[] = [];
  let match = false;
  let current = '';
  for (const char of text) {
    if (char === MARK_START || char === MARK_END) {
      if (current) parts.push({ text: current, match });
      current = '';
      match = char === MARK_START;
    } else current += char;
  }
  if (current) parts.push({ text: current, match });
  return parts;
}
