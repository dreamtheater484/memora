import type { Page } from '@memora/shared';
import { ApiRequestError, api, isUnreachable } from '../lib/api';
import { mergeContent } from './merge';
import {
  absorb,
  fromServer,
  keepMine,
  keepTheirs,
  newWriteId,
  settle,
  write,
  type PageRecord,
  type Unstored,
} from './records';
import type { Sender } from './sender';
import { MemoryStore, type LocalStore, type Op } from './store';

/*
 * A page open in this tab (§9.6). The editor tells it about every change; within 300 ms the
 * text is in the store (and so survives a crash or a closed tab), and a second after the last
 * keystroke, or every 5 s while typing goes on, the leader tab is asked to send it. Changes
 * that reach the store from elsewhere (another tab, a merge, the server) come back here and
 * into the editor; edits not yet stored are merged with them.
 *
 * If the store fails (full, or blocked), the page carries on in memory and this tab saves it
 * to the server itself; the app warns that closing the tab now could lose it.
 */

export interface DocHost {
  readonly store: LocalStore;
  readonly tabId: string;
  readonly sender: Sender;
  /** Ask the leader to send what waits. */
  kick(): void;
  /** This tab changed the record: tell the other tabs. */
  announce(id: string): void;
  /** Writing to the store failed. */
  storageFailed(error: unknown): void;
  /** Something the user should know. */
  notify(message: string): void;
  /** The server answered (so it is reachable). */
  reached(): void;
  /** A request found no server. */
  unreachable(): void;
}

/** An editor showing the page: takes text that changed elsewhere. */
export interface DocEditor {
  set(text: string): void;
}

export type DocState = 'loading' | 'ready' | 'missing' | 'unavailable' | 'error';

export interface DocSnapshot {
  state: DocState;
  record: PageRecord | undefined;
  /** Typed in the last moments and not in the store yet. */
  unpersisted: boolean;
  /** Storing on this device failed: only this tab holds the changes until the server has them. */
  fallback: boolean;
}

export const PERSIST_MS = 300;
export const IDLE_SAVE_MS = 1000;
export const MAX_SAVE_MS = 5000;

export class PageDoc {
  /** Components using the page; it closes when the last one goes. */
  refs = 0;
  private text = '';
  /** Reads the editor's text; set while the text there is newer than `text`. */
  private reader: (() => string) | null = null;
  /** The record write this tab's text grew from. */
  private known = { writeId: '', content: '' };
  private record: PageRecord | undefined;
  private state: DocState = 'loading';
  private unpersisted = false;
  private fallback: MemoryStore | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private maxTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private persisting: Promise<void> | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private readonly editors = new Set<DocEditor>();
  private readonly listeners = new Set<() => void>();
  private snapshot: DocSnapshot;

  constructor(
    readonly id: string,
    private readonly host: DocHost,
  ) {
    this.snapshot = this.makeSnapshot();
  }

  // Reading

  private store(): LocalStore {
    return this.fallback ?? this.host.store;
  }

  /** The page's text as the user sees it. */
  content(): string {
    if (this.reader) this.text = this.reader();
    return this.text;
  }

  getSnapshot = (): DocSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private makeSnapshot(): DocSnapshot {
    return {
      state: this.state,
      record: this.record,
      unpersisted: this.unpersisted,
      fallback: !!this.fallback,
    };
  }

  private emit() {
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }

  // Loading

  /** Shows what this browser has at once, then catches up with the server. */
  async load(): Promise<void> {
    const record = await this.host.store.get(this.id).catch(() => undefined);
    if (record) this.take(record);
    await this.refresh();
  }

  /** Fetches the server's version and takes it in. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        await this.fetchOnce();
      } while (this.refreshAgain);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async fetchOnce() {
    let page: Page;
    try {
      page = await api<Page>('GET', `/pages/${this.id}`);
    } catch (error) {
      if (isUnreachable(error)) this.host.unreachable();
      if (this.record) return; // Offline, or a page made offline: what's here stands.
      const status = error instanceof ApiRequestError ? error.status : -1;
      this.state = isUnreachable(error) ? 'unavailable' : status === 404 ? 'missing' : 'error';
      this.emit();
      return;
    }
    this.host.reached();
    let changed = false;
    const change = (r: PageRecord | undefined) => {
      const next = r ? absorb(r, page) : fromServer(this.id, page, Date.now());
      changed = !!next;
      return next;
    };
    let record: PageRecord | undefined;
    try {
      record = await this.store().update(this.id, change);
    } catch (error) {
      this.useFallback(error);
      record = await this.store().update(this.id, change);
    }
    if (!record) return;
    this.take(record);
    if (changed) this.host.announce(this.id);
    // A merge with the server's version waits to be sent.
    if (record.dirty && !record.conflict) this.scheduleSave(0);
  }

  /** The tree says the server has `revision`: fetch it if this page is behind. */
  seen(revision: number): void {
    const known = this.record?.conflict?.revision ?? this.record?.revision ?? 0;
    if (this.state === 'ready' && revision > known) void this.refresh();
  }

  /** Re-reads the record after another tab (or the leader) changed it. */
  async reload(): Promise<void> {
    if (this.fallback) return;
    const record = await this.host.store.get(this.id).catch(() => undefined);
    this.take(record);
  }

  /**
   * Takes in the record as the store has it. Text changed elsewhere replaces this tab's, or
   * is merged with what was typed here and not stored yet.
   */
  take(record: PageRecord | undefined): void {
    if (!record) {
      if (this.record && !this.unpersisted) {
        this.record = undefined;
        this.state = 'missing';
        this.emit();
      }
      return;
    }
    this.record = record;
    this.state = 'ready';
    if (record.writeId !== this.known.writeId) {
      if (!this.unpersisted) {
        this.known = { writeId: record.writeId, content: record.content };
        if (record.content !== this.content()) this.setText(record.content);
      } else {
        const mine = this.content();
        const merged = mergeContent(record.type, this.known.content, record.content, mine);
        // Unmergeable: keep typing; the next store write keeps the other text as a version.
        if (merged.ok) {
          this.known = { writeId: record.writeId, content: record.content };
          if (merged.text !== mine) this.setText(merged.text);
        }
      }
    }
    this.emit();
  }

  private setText(text: string) {
    this.text = text;
    for (const editor of this.editors) editor.set(text);
  }

  // Editing

  attach(editor: DocEditor): () => void {
    this.editors.add(editor);
    return () => {
      // The editor goes: keep its text.
      if (this.reader) this.text = this.reader();
      this.reader = null;
      this.editors.delete(editor);
    };
  }

  /** The user changed the text in `from`; `read` gets it (only when needed). */
  edited(read: () => string, from?: DocEditor): void {
    this.reader = read;
    const was = this.unpersisted;
    this.unpersisted = true;
    if (this.editors.size > 1) {
      const text = read();
      for (const editor of this.editors) if (editor !== from) editor.set(text);
    }
    this.persistTimer ??= setTimeout(() => void this.persist(), PERSIST_MS);
    this.scheduleSave(IDLE_SAVE_MS);
    if (!was) this.emit();
  }

  private scheduleSave(idle: number) {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.flush(), idle);
    this.maxTimer ??= setTimeout(() => void this.flush(), MAX_SAVE_MS);
  }

  /** Stores the text now (if typed since) and has it sent. */
  async flush(): Promise<void> {
    clearTimeout(this.idleTimer);
    clearTimeout(this.maxTimer);
    this.idleTimer = this.maxTimer = undefined;
    await this.persist();
    if (this.fallback) await this.saveDirectly();
    else this.host.kick();
  }

  /** Writes the text into the store (merging with any write from elsewhere). */
  async persist(): Promise<void> {
    while (this.persisting) await this.persisting;
    if (!this.unpersisted) return;
    this.persisting = this.writeOnce().finally(() => {
      this.persisting = null;
    });
    return this.persisting;
  }

  private async writeOnce() {
    clearTimeout(this.persistTimer);
    this.persistTimer = undefined;
    const text = this.content();
    const known = this.known;
    const last = this.record;
    let displaced: string | undefined;
    const change = (r: PageRecord | undefined) => {
      if (!r) {
        // Dropped from the cache meanwhile: start again from what this tab had.
        return last
          ? settle({ ...last, content: text, writeId: newWriteId(), writer: this.host.tabId })
          : undefined;
      }
      const written = write(r, known, text, this.host.tabId, Date.now());
      displaced = written.displaced;
      return written.record;
    };
    let record: PageRecord | undefined;
    try {
      record = await this.store().update(this.id, change);
    } catch (error) {
      if (this.fallback) throw error;
      this.useFallback(error);
      record = await this.store().update(this.id, change);
    }
    // Not stored (still `unpersisted`): the next write tries again.
    if (!record) return;
    if (displaced !== undefined) {
      await this.keepLater({
        kind: 'keepVersion',
        pageId: this.id,
        content: displaced,
        baseRevision: record.revision,
      });
      this.host.notify(
        'This page was also changed in another tab. That text was kept as a version of the page.',
      );
    }
    this.record = record;
    this.known = { writeId: record.writeId, content: record.content };
    // Only now is the text safe (and "Saved" possible once it's sent): not while writing.
    this.unpersisted = false;
    if (record.content !== text) {
      // Merged with another tab's text: bring it in, with anything typed meanwhile.
      const now = this.content();
      if (now === text) this.setText(record.content);
      else {
        const merged = mergeContent(record.type, text, record.content, now);
        if (merged.ok) this.setText(merged.text);
        // Unmergeable: the next write sees a changed record and keeps its text.
        else this.known = { writeId: '', content: text };
        this.unpersisted = true;
      }
    } else if (this.content() !== text) this.unpersisted = true;
    if (!this.fallback) this.host.announce(this.id);
    this.emit();
  }

  /** Stores something to send before content, or sends it now when there's no store. */
  private async keepLater(op: Op) {
    if (!this.fallback) {
      await this.host.store.addOp(op);
      return;
    }
    if (op.kind !== 'keepVersion') return;
    await api('POST', `/pages/${op.pageId}/versions`, {
      reason: 'conflict',
      content: op.content,
      baseRevision: op.baseRevision,
    }).catch(() => undefined);
  }

  private useFallback(error: unknown) {
    this.fallback = new MemoryStore();
    const last = this.record;
    if (last) void this.fallback.update(this.id, () => last);
    // The stored copy is older than what this tab now holds, which carries on from it.
    void this.host.store.update(this.id, () => null).catch(() => undefined);
    this.host.storageFailed(error);
    this.emit();
  }

  /** Without a store, this tab sends its own changes. */
  private async saveDirectly() {
    clearTimeout(this.retryTimer);
    const record = await this.fallback!.get(this.id);
    if (!record?.dirty || record.conflict) return;
    try {
      await this.host.sender.save(record, this.fallback!);
      this.retries = 0;
    } catch {
      const delay = Math.min(30_000, 1000 * 2 ** this.retries++) * (0.7 + Math.random() * 0.6);
      this.retryTimer = setTimeout(() => void this.flush(), delay);
    }
    this.take(await this.fallback!.get(this.id));
  }

  // Conflicts

  /** Keep mine (or a combination chosen in Compare): it replaces the server's version. */
  async keepMine(content?: string): Promise<void> {
    await this.persist();
    const text = content ?? this.content();
    const record = await this.store().update(this.id, (r) => r?.conflict && keepMine(r, text));
    this.take(record);
    if (!this.fallback) this.host.announce(this.id);
    await this.flush();
  }

  /** Keep theirs: the server's version stays; this browser's text is kept as a version. */
  async keepTheirs(): Promise<void> {
    await this.persist();
    const current = await this.store().get(this.id);
    if (!current?.conflict) return;
    if (current.conflict.kept !== current.writeId) {
      await this.keepLater({
        kind: 'keepVersion',
        pageId: this.id,
        content: current.content,
        baseRevision: current.revision,
      });
    }
    const record = await this.store().update(this.id, (r) => r?.conflict && keepTheirs(r));
    this.take(record);
    if (!this.fallback) this.host.announce(this.id);
    this.host.kick();
  }

  // Closing

  /** Stores and sends what's left, and stops. */
  async close(): Promise<void> {
    clearTimeout(this.retryTimer);
    await this.flush();
    clearTimeout(this.persistTimer);
    this.listeners.clear();
  }

  /** Something typed here isn't safe in the store yet. */
  atRisk(): boolean {
    return this.unpersisted || (!!this.fallback && !!this.record?.dirty);
  }

  /** What only this tab holds, for keeping at once as the tab goes away. */
  unstored(): Unstored | null {
    const record = this.record;
    if (!record || this.state !== 'ready' || !this.atRisk()) return null;
    const { type, revision, base } = record;
    return { text: this.content(), known: this.known, type, revision, base };
  }
}
