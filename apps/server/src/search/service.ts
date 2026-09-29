import {
  MARK_START,
  parseSearch,
  snippetOf,
  tagKey,
  type ModifiedWithin,
  type PageType,
  type SearchHit,
  type SearchResponse,
  type searchQuerySchema,
} from '@memora/shared';
import type { z } from 'zod';
import type { SqliteDatabase } from '../db/client';

/*
 * Search (§9.8) over `fts_pages` (§7.5), which triggers keep current with every change.
 * Titles weigh ten times the text and tags four times; pages opened lately get a small boost.
 * Every word is matched as a prefix, so results come while a word is still being typed.
 */

const DAY = 24 * 3_600_000;
const SPAN: Record<ModifiedWithin, number> = {
  day: DAY,
  week: 7 * DAY,
  month: 31 * DAY,
  year: 366 * DAY,
};

/** Pages opened lately rank a little higher (bm25 scores are negative: lower is better). */
const RECENT_BOOST = 1.3;
/** Matches are counted up to here. */
const MAX_COUNT = 1000;

const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;
/** Text FTS can find: at least one letter or digit. */
const findable = (text: string) => /[\p{L}\p{N}]/u.test(text);

interface Row {
  id: string;
  sectionId: string;
  type: PageType;
  updatedAt: number;
  title: string;
  snippet: string | null;
  text: string;
  tags: string | null;
}

export class SearchService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => number,
  ) {}

  search(
    owner: string,
    query: z.output<typeof searchQuerySchema>,
    recent: readonly string[] = [],
  ): SearchResponse {
    const parsed = parseSearch(query.q);
    const positive = [
      ...parsed.words.filter(findable).map((w) => `${quote(w)}*`),
      ...parsed.phrases.filter(findable).map(quote),
    ];
    const excluded = parsed.exclude.filter(findable).map(quote);

    const where: string[] = ['p.owner_id = @owner', 'p.deleted_at IS NULL'];
    const params: Record<string, unknown> = { owner, recent: JSON.stringify(recent) };
    if (query.sectionId) {
      where.push('p.section_id = @sectionId');
      params.sectionId = query.sectionId;
    }
    if (query.notebookId) {
      where.push('p.section_id IN (SELECT id FROM sections WHERE notebook_id = @notebookId)');
      params.notebookId = query.notebookId;
    }
    if (query.tagId) {
      where.push('EXISTS (SELECT 1 FROM page_tags WHERE page_id = p.id AND tag_id = @tagId)');
      params.tagId = query.tagId;
    }
    if (query.type) {
      where.push('p.type = @type');
      params.type = query.type;
    }
    if (query.modified) {
      where.push('p.updated_at >= @since');
      params.since = this.now() - SPAN[query.modified];
    }
    parsed.tags.forEach((name, i) => {
      where.push(
        `EXISTS (SELECT 1 FROM page_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.page_id = p.id AND t.owner_id = @owner AND t.name_key = @tag${i})`,
      );
      params[`tag${i}`] = tagKey(name);
    });
    parsed.within.forEach((name, i) => {
      // A section of that name, or a notebook (and so its sections).
      where.push(
        `p.section_id IN (SELECT s.id FROM sections s LEFT JOIN notebooks n ON n.id = s.notebook_id WHERE s.owner_id = @owner AND (lower(s.name) = @in${i} OR lower(n.name) = @in${i}))`,
      );
      params[`in${i}`] = name.trim().toLowerCase();
    });

    const tagsColumn = '(SELECT group_concat(tag_id) FROM page_tags WHERE page_id = p.id) AS tags';
    let rows: Row[];
    let total: number;
    if (positive.length) {
      params.match = excluded.length
        ? `(${positive.join(' ')}) NOT (${excluded.join(' OR ')})`
        : positive.join(' ');
      const from = `FROM fts_pages JOIN page_search s ON s.docid = fts_pages.rowid
        JOIN pages p ON p.id = s.page_id WHERE fts_pages MATCH @match AND ${where.join(' AND ')}`;
      rows = this.db
        .prepare(
          `SELECT p.id, p.section_id AS sectionId, p.type, p.updated_at AS updatedAt,
            highlight(fts_pages, 0, char(1), char(2)) AS title,
            snippet(fts_pages, 1, char(1), char(2), '…', 16) AS snippet,
            substr(p.content_text, 1, 400) AS text, ${tagsColumn}
          ${from}
          ORDER BY bm25(fts_pages, 10.0, 1.0, 4.0)
            * (CASE WHEN p.id IN (SELECT value FROM json_each(@recent)) THEN ${RECENT_BOOST} ELSE 1 END),
            p.updated_at DESC
          LIMIT @limit`,
        )
        .all({ ...params, limit: query.limit }) as Row[];
      total = this.count(from, params);
    } else {
      // Filters only (or only words to leave out): the latest pages that fit.
      if (!excluded.length && where.length === 2) {
        return { hits: [], total: 0 };
      }
      if (excluded.length) {
        params.match = excluded.join(' OR ');
        where.push(
          'p.id NOT IN (SELECT s.page_id FROM fts_pages JOIN page_search s ON s.docid = fts_pages.rowid WHERE fts_pages MATCH @match)',
        );
      }
      const from = `FROM pages p WHERE ${where.join(' AND ')}`;
      rows = this.db
        .prepare(
          `SELECT p.id, p.section_id AS sectionId, p.type, p.updated_at AS updatedAt,
            p.title, NULL AS snippet, substr(p.content_text, 1, 400) AS text, ${tagsColumn}
          ${from} ORDER BY p.updated_at DESC LIMIT @limit`,
        )
        .all({ ...params, limit: query.limit }) as Row[];
      total = this.count(from, params);
    }
    return { hits: rows.map(toHit), total };
  }

  private count(from: string, params: Record<string, unknown>): number {
    const row = this.db
      .prepare(`SELECT count(*) AS n FROM (SELECT 1 ${from} LIMIT ${MAX_COUNT})`)
      .get(params) as { n: number };
    return row.n;
  }
}

function toHit(row: Row): SearchHit {
  // Only the title matched: the page's start instead of a snippet without a match.
  const snippet =
    row.snippet && row.snippet.includes(MARK_START) ? row.snippet.trim() : snippetOf(row.text);
  return {
    id: row.id,
    title: row.title,
    snippet,
    sectionId: row.sectionId,
    type: row.type,
    tags: row.tags ? row.tags.split(',').sort() : [],
    updatedAt: row.updatedAt,
  };
}
