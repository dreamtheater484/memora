import type { Page, PageType } from '@memora/shared';
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
 *
 * Text that arrives from elsewhere is the page's text from then on: an editor's older text is
 * never read over it. Only an editor that shows the page as it is now counts: one of the
 * page's type (a conversion changes it under an open editor), and one that could take its
 * latest text. Any other editor is never given text and never saves.
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
  /**
   * The kind of page it edits: it is only given text of that kind, and only saves while the
   * page is of that kind.
   */
  readonly pageType: PageType;
  /**
   * Shows text that changed elsewhere. Answers false when it can't (a document it can't
   * read): it then still shows older text, which is never saved over the page.
   */
  set(text: string): boolean | void;
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
  /** Reads an editor's text; set while the text there is newer than `text`. */
  private reader: { read: () => string; from: DocEditor } | null = null;
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
  /** Editors that couldn't take the page's latest text: they show older text, not the page. */
  private readonly behind = new Set<DocEditor>();
  private readonly listeners = new Set<() => void>();
  /** Edited in this tab since it was opened: closing it keeps a version (§9.7). */
  private editedHere = false;
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
    const reader = this.reader;
    if (reader && this.counts(reader.from)) this.text = reader.read();
    return this.text;
  }

  /** Whether an editor shows the page as it is now, so that what it holds is the page. */
  private counts(editor: DocEditor): boolean {
    return (
      this.editors.has(editor) &&
      !this.behind.has(editor) &&
      (!this.record || editor.pageType === this.record.type)
    );
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
    if (this.record && this.record.type !== record.type) {
      this.retype(record);
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

  /**
   * The page was converted (here, in another tab or on another device): its text is now of
   * the other type. The open editor of the old type is never given it, and what it holds is
   * never read again: the page follows the record. Anything typed here that isn't stored yet
   * can't go into the page any more, so it is kept as a version.
   */
  private retype(record: PageRecord) {
    const before = this.record!;
    // Still read as the old type, by the editor that holds it.
    const mine = this.content();
    const typed = this.unpersisted && mine !== this.known.content;
    this.record = record;
    this.state = 'ready';
    this.known = { writeId: record.writeId, content: record.content };
    this.unpersisted = false;
    this.setText(record.content);
    if (typed) {
      void this.keepLater({
        kind: 'keepVersion',
        pageId: this.id,
        content: mine,
        baseRevision: before.revision,
      }).catch(() => undefined);
      this.host.notify(
        'This page was converted meanwhile. What you had just typed was kept as a version of the page.',
      );
    }
    this.emit();
  }

  /** Text from elsewhere becomes the page's text, in every editor that can show it. */
  private setText(text: string) {
    this.text = text;
    // No editor's older text may be read over it (until the user types again).
    this.reader = null;
    for (const editor of this.editors) this.offer(editor, text);
  }

  /** Gives an editor of the page's type its text; one that can't show it falls behind. */
  private offer(editor: DocEditor, text: string) {
    if (this.record && editor.pageType !== this.record.type) return;
    if (editor.set(text) === false) this.behind.add(editor);
    else this.behind.delete(editor);
  }

  // Editing

  /** An editor shows the page: it gets the page's text, and its changes are taken from now on. */
  attach(editor: DocEditor): () => void {
    const text = this.content();
    this.editors.add(editor);
    this.offer(editor, text);
    return () => {
      // The editor goes: what was typed in it is the page's text (if it still counts).
      if (this.reader?.from === editor) {
        this.content();
        this.reader = null;
      }
      this.editors.delete(editor);
      this.behind.delete(editor);
    };
  }

  /**
   * The user changed the text in `from`; `read` gets it (only when needed). Ignored from an
   * editor that doesn't show the page as it is now (see `counts`): its text isn't the page's.
   */
  edited(read: () => string, from: DocEditor): void {
    if (!this.counts(from)) return;
    this.reader = { read, from };
    this.editedHere = true;
    const was = this.unpersisted;
    this.unpersisted = true;
    if (this.editors.size > 1) {
      const text = read();
      for (const editor of this.editors) if (editor !== from) this.offer(editor, text);
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
    let retyped = false;
    const change = (r: PageRecord | undefined) => {
      if (!r) {
        // Dropped from the cache meanwhile: start again from what this tab had.
        return last
          ? settle({ ...last, content: text, writeId: newWriteId(), writer: this.host.tabId })
          : undefined;
      }
      // Converted meanwhile (another tab took it in): text of the old type never goes into it.
      if (last && r.type !== last.type) {
        retyped = true;
        return undefined;
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
    if (retyped) {
      // The page follows the conversion; what was typed is kept as a version.
      if (this.record && this.record.type !== record.type) this.retype(record);
      return;
    }
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

  /** Stores and sends what's left, and stops. A page edited here then keeps a version. */
  async close(): Promise<void> {
    clearTimeout(this.retryTimer);
    await this.flush();
    clearTimeout(this.persistTimer);
    if (this.editedHere && !this.fallback) void this.snapshotWhenSaved();
    this.listeners.clear();
  }

  /** Once what was typed is on the server, asks it to keep the page as a version. */
  private async snapshotWhenSaved() {
    const record = await this.whenSaved(15_000);
    if (!record) return;
    await api('POST', `/pages/${this.id}/versions`, { reason: 'auto' }).catch(() => undefined);
  }

  /** Waits until everything typed on the page is on the server; null if that takes too long. */
  whenSaved(timeout = 10_000): Promise<PageRecord | null> {
    return new Promise((resolve) => {
      let unsubscribe = () => {};
      const done = (value: PageRecord | null) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(value);
      };
      const check = () => {
        const { record, unpersisted, state } = this.snapshot;
        if (state === 'ready' && record && !record.dirty && !unpersisted) done(record);
      };
      const timer = setTimeout(() => done(null), timeout);
      // Watched through the store too: the listeners are cleared when the page closes.
      const poll = setInterval(() => void this.reload().then(check), 500);
      unsubscribe = (() => {
        const off = this.subscribe(check);
        return () => {
          off();
          clearInterval(poll);
        };
      })();
      check();
    });
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
