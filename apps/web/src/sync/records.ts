import type { PageType } from '@memora/shared';
import { merge3 } from './merge';

/*
 * A page as this browser has it (§9.6). `base` is the server's content at `revision`, the
 * last version both sides agreed on; `content` is this browser's, which may be ahead. Every
 * tab of the browser writes into the same record, so there is one line of edits per page, and
 * the server's answers only ever move the base forward.
 *
 * Everything here is a pure function of a record, so the rules can be tested on their own.
 */

export interface PageRecord {
  id: string;
  type: PageType;
  /** The server revision `base` belongs to. */
  revision: number;
  base: string;
  content: string;
  /** Changes with every change to `content`, so a tab can tell whether someone else wrote. */
  writeId: string;
  /** The tab that wrote `content` last ('' when it came from the server). */
  writer: string;
  /** 1 while something needs sending (a number, because IndexedDB can't index booleans). */
  dirty: 0 | 1;
  /** Last opened or written, for dropping old pages from the cache. */
  touchedAt: number;
  /** Set when the server's version and this one changed the same text. */
  conflict?: Conflict;
  /** The next save settles a conflict, so the server keeps what it replaces. */
  resolving?: boolean;
}

export interface Conflict {
  /** The server's version, which `content` couldn't be merged with. */
  revision: number;
  content: string;
  /** The write of this browser's side last kept as a version on the server. */
  kept: string | null;
}

/** What the server says a page is. */
export interface ServerPage {
  revision: number;
  content: string;
  type: PageType;
}

let counter = 0;
export const newWriteId = (): string =>
  `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The server was set back (a restore): keep this browser's text, based on what it has now. */
export function rebase(record: PageRecord, page: ServerPage): PageRecord {
  return settle({ ...record, revision: page.revision, base: page.content, type: page.type });
}

/** Sets `dirty` from the rest. */
export function settle(record: Omit<PageRecord, 'dirty'>): PageRecord {
  const dirty = record.content !== record.base || !!record.conflict || !!record.resolving;
  return { ...record, dirty: dirty ? 1 : 0 };
}

/** A page just loaded from the server, with nothing local. */
export function fromServer(id: string, page: ServerPage, now: number): PageRecord {
  return settle({
    id,
    type: page.type,
    revision: page.revision,
    base: page.content,
    content: page.content,
    writeId: newWriteId(),
    writer: '',
    touchedAt: now,
  });
}

/**
 * Takes in a newer server version. Unchanged local text simply follows it; local edits are
 * merged with it (Markdown); edits that can't be merged become a conflict, with both kept.
 * Returns undefined when there is nothing to change.
 */
export function absorb(record: PageRecord, page: ServerPage): PageRecord | undefined {
  if (record.conflict) {
    if (page.revision <= record.conflict.revision) return undefined;
    if (page.content === record.content) return follow(record, page);
    return {
      ...record,
      conflict: { ...record.conflict, revision: page.revision, content: page.content },
    };
  }
  if (page.revision <= record.revision) return undefined;
  if (record.content === record.base || record.content === page.content)
    return follow(record, page);
  const merged =
    record.type === 'markdown' && page.type === 'markdown'
      ? merge3(record.base, page.content, record.content)
      : ({ ok: false } as const);
  if (merged.ok) {
    return settle({
      ...record,
      revision: page.revision,
      base: page.content,
      content: merged.text,
      type: page.type,
      writeId: newWriteId(),
      writer: '',
    });
  }
  return settle({
    ...record,
    conflict: { revision: page.revision, content: page.content, kept: null },
  });
}

/** Local and server text agree: the record simply becomes the server's version. */
function follow(record: PageRecord, page: ServerPage): PageRecord {
  const changed = record.content !== page.content;
  return settle({
    ...record,
    type: page.type,
    revision: page.revision,
    base: page.content,
    content: page.content,
    conflict: undefined,
    resolving: undefined,
    writeId: changed ? newWriteId() : record.writeId,
    writer: changed ? '' : record.writer,
  });
}

/**
 * The server took `sent` (written as `sentWriteId`, based on `sentRevision`) as `revision`.
 * Content written since then stays, now based on what was sent. A record that meanwhile moved
 * to a newer server version is left alone.
 */
export function saved(
  record: PageRecord,
  sent: { writeId: string; content: string; revision: number },
  revision: number,
): PageRecord | undefined {
  if (record.revision !== sent.revision || record.conflict) return undefined;
  return settle({
    ...record,
    revision,
    base: sent.content,
    resolving: record.writeId === sent.writeId ? undefined : record.resolving,
  });
}

/** Result of writing a tab's text into the shared record. */
export interface Written {
  record: PageRecord;
  /** Text that another tab had written and this write couldn't merge with, to keep. */
  displaced?: string;
}

/**
 * Writes a tab's text. `known` is the record's write the tab's text grew from: if someone
 * else wrote since, their text and this tab's are merged; if that fails, this tab's text wins
 * and the other is handed back to be kept as a version.
 */
export function write(
  record: PageRecord,
  known: { writeId: string; content: string },
  text: string,
  writer: string,
  now: number,
): Written {
  const next = (content: string) =>
    settle({ ...record, content, writeId: newWriteId(), writer, touchedAt: now });
  if (record.writeId === known.writeId || record.content === known.content) {
    return { record: next(text) };
  }
  if (text === known.content) return { record: { ...record, touchedAt: now } };
  const merged =
    record.type === 'markdown'
      ? merge3(known.content, record.content, text)
      : { ok: false as const };
  if (merged.ok) return { record: next(merged.text) };
  return { record: next(text), displaced: record.content };
}

/**
 * Text a tab couldn't store before it went away (closed or reloaded in the moment after a
 * keystroke), kept in local storage, which is written at once.
 */
export interface Unstored {
  text: string;
  /** The record write the text grew from. */
  known: { writeId: string; content: string };
  // Enough to make the record again when the store doesn't have it.
  type: PageType;
  revision: number;
  base: string;
}

/** Brings text a closed tab couldn't store into the page's record, or a new one. */
export function restore(
  id: string,
  record: PageRecord | undefined,
  unstored: Unstored,
  writer: string,
  now: number,
): Written {
  if (record) return write(record, unstored.known, unstored.text, writer, now);
  const { type, revision, base, text } = unstored;
  return {
    record: settle({
      id,
      type,
      revision,
      base,
      content: text,
      writeId: newWriteId(),
      writer,
      touchedAt: now,
    }),
  };
}

/** Keep mine: this browser's text replaces the server's version, which the server keeps. */
export function keepMine(record: PageRecord, content = record.content): PageRecord {
  if (!record.conflict) return record;
  return settle({
    ...record,
    revision: record.conflict.revision,
    base: record.conflict.content,
    content,
    conflict: undefined,
    resolving: true,
    writeId: newWriteId(),
    writer: '',
  });
}

/**
 * Keep theirs: the server's version stays. This browser's text must have been kept as a
 * version first (`conflict.kept === writeId`).
 */
export function keepTheirs(record: PageRecord): PageRecord {
  if (!record.conflict) return record;
  return settle({
    ...record,
    revision: record.conflict.revision,
    base: record.conflict.content,
    content: record.conflict.content,
    conflict: undefined,
    resolving: undefined,
    writeId: newWriteId(),
    writer: '',
  });
}
