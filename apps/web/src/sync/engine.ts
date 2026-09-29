import {
  markdownToText,
  snippetOf,
  uuidv7,
  type ContentSaved,
  type CreatePageRequest,
  type PageMeta,
  type ServerEvent,
  type Tree,
  type TreeChanges,
} from '@memora/shared';
import type { QueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { toast } from '../components/ui/toast-store';
import { ApiRequestError, hasCsrfToken } from '../lib/api';
import { treeKey } from '../notes/keys';
import { mergeChanges } from '../notes/model';
import { PageDoc, type DocHost } from './doc';
import { Live, type LiveHost } from './live';
import { newWriteId, restore, settle, type Unstored } from './records';
import { Sender, type SenderHost } from './sender';
import { initialShared, useSync, type Shared } from './status';
import { openStore, type LocalStore } from './store';

/*
 * The sync engine of one tab (§9.6). Tabs of the same browser share the store and a
 * `BroadcastChannel`; a Web Lock picks one "leader" that sends the outbox, keeps the
 * WebSocket and relays what it hears. When the leader tab closes, another takes over.
 * Without Web Locks, or without a durable store, a tab simply leads itself: the server's
 * revision checks keep that safe, it's only a little more traffic.
 */

type Message =
  /** To the leader: something waits to be sent. */
  | { t: 'kick' }
  /** A page's record changed in the store. */
  | { t: 'record'; id: string }
  /** From the leader: the server side of the status. */
  | { t: 'shared'; shared: Shared }
  /** From the leader: an event from the server (or a save's result). */
  | { t: 'event'; event: ServerEvent }
  /** The tree changed here: reload it. */
  | { t: 'tree' }
  /** To the leader: the pages a tab has open. */
  | { t: 'presence'; tab: string; pages: string[] }
  | { t: 'bye'; tab: string }
  /** From a new leader: report your open pages. */
  | { t: 'hello' }
  /** From a new tab: send me the status. */
  | { t: 'join' };

/** Unchanged pages kept for offline reading. */
const CACHED_PAGES = 100;
/** The leader looks through the outbox this often, for changes left by tabs that crashed. */
const SWEEP_MS = 30_000;
/** A page opened but never shown closes after this. */
const UNUSED_DOC_MS = 5_000;
/** The kept tree is written at most this often while it changes. */
const TREE_WRITE_MS = 1_000;
/** Local storage keys of text tabs couldn't store as they went: `<prefix><user>.<tab>`. */
const UNSTORED_PREFIX = 'memora.unstored.';
/** The service worker's cache of files in pages (sw.js). */
const FILES_CACHE = 'memora-files';

export interface EngineOptions {
  /** The server ended the session. */
  onSignedOut: () => void;
  /** Gets a fresh session check (with a CSRF token); answers whether still signed in. */
  refreshSession: () => Promise<boolean>;
}

export class SyncEngine implements SenderHost, DocHost, LiveHost {
  readonly tabId = newWriteId();
  readonly sender: Sender;
  private channel: BroadcastChannel | null = null;
  private leader = false;
  private live: Live | null = null;
  private readonly docs = new Map<string, PageDoc>();
  private readonly tabPages = new Map<string, string[]>();
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private releaseLead: (() => void) | null = null;
  private readonly abort = new AbortController();
  private stopped = false;

  constructor(
    readonly userId: string,
    readonly store: LocalStore,
    private readonly queryClient: QueryClient,
    private readonly options: EngineOptions,
  ) {
    this.sender = new Sender(this);
  }

  start(): void {
    useSync.setState({
      ...initialShared,
      online: navigator.onLine,
      durable: this.store.durable,
      storageError: this.store.durable ? null : 'unavailable',
      unsaved: [],
    });
    if (typeof BroadcastChannel !== 'undefined' && this.store.durable) {
      this.channel = new BroadcastChannel(`memora-sync-${this.userId}`);
      this.channel.onmessage = (e: MessageEvent<Message>) => this.receive(e.data);
    }
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (locks && this.channel) {
      locks
        .request(
          `memora-leader-${this.userId}`,
          { signal: this.abort.signal },
          () =>
            new Promise<void>((resolve) => {
              this.releaseLead = resolve;
              this.lead();
            }),
        )
        .catch(() => undefined);
      this.post({ t: 'join' });
    } else {
      this.lead();
    }

    // The tree is kept on this device for starting offline, as it changes here.
    const unsubscribe = this.queryClient.getQueryCache().subscribe((event) => {
      const key = event.query.queryKey;
      if (
        event.type === 'updated' &&
        event.action.type === 'success' &&
        key[0] === treeKey[0] &&
        key[1] === treeKey[1]
      ) {
        this.keepTreeSoon();
      }
    });
    this.abort.signal.addEventListener('abort', unsubscribe);

    const signal = this.abort.signal;
    window.addEventListener('online', this.onOnline, { signal });
    window.addEventListener('offline', () => useSync.setState({ online: false }), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') this.flushAll();
      },
      { signal },
    );
    window.addEventListener(
      'pagehide',
      () => {
        this.keepUnstored();
        this.flushAll();
        this.post({ t: 'bye', tab: this.tabId });
      },
      { signal },
    );
    // Back from the back-forward cache: the tab has its text again.
    window.addEventListener(
      'pageshow',
      (event) => {
        if (event.persisted) this.forgetUnstored();
      },
      { signal },
    );
    void this.restoreUnstored().catch(() => undefined);
    window.addEventListener('beforeunload', this.onBeforeUnload, { signal });
  }

  /**
   * Stops syncing (signing out, another user): what's typed is stored and sent first.
   * `forget` also drops this device's copy of everything already on the server.
   */
  async stop({ forget = false } = {}): Promise<void> {
    if (this.stopped) return;
    const closing = [...this.docs.values()].map((doc) => doc.close());
    this.docs.clear();
    await Promise.allSettled(closing);
    if (this.leader) await this.sender.kick();
    this.stopped = true;
    if (forget) {
      await this.store.forgetClean().catch(() => undefined);
      // Files in pages, kept by the service worker for offline reading.
      if (typeof caches !== 'undefined') await caches.delete(FILES_CACHE).catch(() => false);
    }
    for (const url of this.fileUrls.values()) URL.revokeObjectURL(url);
    this.fileUrls.clear();
    this.abort.abort();
    this.releaseLead?.();
    this.live?.stop();
    this.sender.stop();
    clearInterval(this.sweepTimer);
    clearTimeout(this.recountTimer);
    clearTimeout(this.treeTimer);
    this.channel?.close();
    this.store.close();
  }

  private lead() {
    if (this.stopped) return;
    this.leader = true;
    this.tabPages.set(this.tabId, this.openPages());
    this.post({ t: 'hello' });
    this.live = new Live(this);
    this.live.start();
    void this.store.trim(CACHED_PAGES).catch(() => undefined);
    void this.sender.kick();
    this.sweepTimer = setInterval(() => void this.sender.kick(), SWEEP_MS);
  }

  private post(message: Message) {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel: this tab is going away.
    }
  }

  private receive(message: Message) {
    switch (message.t) {
      case 'kick':
        if (this.leader) void this.sender.kick();
        break;
      case 'record':
        void this.docs.get(message.id)?.reload();
        if (this.leader) this.recountSoon();
        break;
      case 'shared':
        if (!this.leader) useSync.setState(message.shared);
        break;
      case 'event':
        this.handle(message.event);
        break;
      case 'tree':
        void this.queryClient.invalidateQueries({ queryKey: treeKey });
        break;
      case 'presence':
        if (this.leader) {
          this.tabPages.set(message.tab, message.pages);
          this.sendPresence();
        }
        break;
      case 'bye':
        if (this.leader) {
          this.tabPages.delete(message.tab);
          this.sendPresence();
        }
        break;
      case 'hello':
        this.post({ t: 'presence', tab: this.tabId, pages: this.openPages() });
        break;
      case 'join':
        if (this.leader) this.post({ t: 'shared', shared: this.shared() });
        break;
    }
  }

  private onOnline = () => {
    useSync.setState({ online: true });
    this.live?.retryNow();
    this.kick();
  };

  private onBeforeUnload = (event: BeforeUnloadEvent) => {
    const atRisk = [...this.docs.values()].some((doc) => doc.atRisk());
    this.flushAll();
    if (atRisk) event.preventDefault();
  };

  private flushAll() {
    for (const doc of this.docs.values()) void doc.flush();
  }

  // Text typed in the moment before the tab went away

  private unstoredKey() {
    return `${UNSTORED_PREFIX}${this.userId}.${this.tabId}`;
  }

  /**
   * The tab is going: text not in the store yet also goes to local storage, which is written
   * at once. A store write started now may not finish before the page is gone.
   */
  private keepUnstored() {
    const pages: Record<string, Unstored> = {};
    for (const doc of this.docs.values()) {
      const unstored = doc.unstored();
      if (unstored) pages[doc.id] = unstored;
    }
    if (!Object.keys(pages).length) return;
    try {
      localStorage.setItem(this.unstoredKey(), JSON.stringify(pages));
    } catch {
      // Full or blocked: the store write may still make it.
    }
  }

  private forgetUnstored() {
    try {
      localStorage.removeItem(this.unstoredKey());
    } catch {
      // Nothing was kept, then.
    }
  }

  /** Text closed tabs left in local storage: into the store, and on its way to the server. */
  private async restoreUnstored() {
    const prefix = `${UNSTORED_PREFIX}${this.userId}.`;
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(prefix));
    for (const key of keys) {
      let pages: Record<string, Unstored> = {};
      try {
        pages = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, Unstored>;
      } catch {
        // Unreadable: nothing to bring back.
      }
      for (const [id, unstored] of Object.entries(pages)) {
        let displaced: string | undefined;
        const record = await this.store.update(id, (r) => {
          const written = restore(id, r, unstored, this.tabId, Date.now());
          displaced = written.displaced;
          return written.record;
        });
        if (record && displaced !== undefined) {
          await this.store.addOp({
            kind: 'keepVersion',
            pageId: id,
            content: displaced,
            baseRevision: record.revision,
          });
        }
        this.changed(id, record);
      }
      // Only once it's all in the store: a failure leaves it for the next start.
      localStorage.removeItem(key);
    }
    if (keys.length) this.kick();
  }

  // Pages open in this tab

  /**
   * The page, opened (and loading) if it wasn't. Components `retain` it while they show it;
   * one nobody retains closes after a while.
   */
  doc(id: string): PageDoc {
    let doc = this.docs.get(id);
    if (!doc) {
      doc = new PageDoc(id, this);
      this.docs.set(id, doc);
      doc.subscribe(() => this.watchUnsaved());
      void doc.load();
      this.reportPresence();
      this.closeUnused(doc, UNUSED_DOC_MS);
    }
    return doc;
  }

  retain(doc: PageDoc): void {
    doc.refs += 1;
  }

  release(doc: PageDoc): void {
    doc.refs -= 1;
    // A moment later: React may take it again straight away.
    this.closeUnused(doc, 0);
  }

  private closeUnused(doc: PageDoc, delay: number) {
    setTimeout(() => {
      if (doc.refs > 0 || this.docs.get(doc.id) !== doc) return;
      this.docs.delete(doc.id);
      void doc.close().then(() => this.watchUnsaved());
      this.reportPresence();
    }, delay);
  }

  private openPages() {
    return [...this.docs.keys()];
  }

  private watchUnsaved() {
    const unsaved = [...this.docs.values()]
      .filter((d) => {
        const { unpersisted, record } = d.getSnapshot();
        return unpersisted || !!record?.dirty;
      })
      .map((d) => d.id);
    const now = useSync.getState().unsaved;
    if (unsaved.length !== now.length || unsaved.some((id, i) => id !== now[i])) {
      useSync.setState({ unsaved });
    }
  }

  private reportPresence() {
    if (this.leader) {
      this.tabPages.set(this.tabId, this.openPages());
      this.sendPresence();
    } else {
      this.post({ t: 'presence', tab: this.tabId, pages: this.openPages() });
    }
  }

  private sendPresence() {
    this.live?.presence([...this.tabPages.values()].flat());
  }

  // Server events

  private handle(event: ServerEvent) {
    switch (event.type) {
      case 'tree.changed':
        void this.queryClient.invalidateQueries({ queryKey: treeKey });
        break;
      case 'page.updated':
        this.mergeTree({ pages: [event.page] });
        this.docs.get(event.page.id)?.seen(event.revision);
        break;
      case 'presence':
        useSync.setState({ devices: event.devices });
        break;
    }
  }

  private mergeTree(changes: TreeChanges) {
    this.queryClient.setQueryData<Tree>(treeKey, (tree) => tree && mergeChanges(tree, changes));
  }

  /** Rows for pages made offline that the server doesn't have yet. */
  async overlay(tree: Tree): Promise<Tree> {
    const ops = await this.store.ops().catch(() => []);
    const have = new Set(tree.pages.map((p) => p.id));
    const extra = ops.flatMap((op) =>
      op.kind === 'createPage' && !have.has(op.meta.id) ? [op.meta] : [],
    );
    return extra.length ? { ...tree, pages: [...tree.pages, ...extra] } : tree;
  }

  /** A page made while the server can't be reached: it is created when it can. */
  async createOffline(body: CreatePageRequest & { id: string }, meta: PageMeta): Promise<void> {
    await this.store.addOp({ kind: 'createPage', body, meta });
    const content = body.content ?? '';
    await this.store.update(body.id, () =>
      settle({
        id: body.id,
        type: body.type ?? 'markdown',
        revision: 1,
        base: content,
        content,
        writeId: newWriteId(),
        writer: this.tabId,
        touchedAt: Date.now(),
      }),
    );
    this.kick();
  }

  /**
   * Renames a page made offline that the server doesn't have yet: the name goes into its
   * creation. Answers the page's new row, or null when there's no such page waiting.
   */
  async renamePending(id: string, title: string): Promise<PageMeta | null> {
    const op = (await this.store.ops()).find((o) => o.kind === 'createPage' && o.body.id === id);
    if (op?.kind !== 'createPage') return null;
    const name = title.trim();
    const next = { ...op, body: { ...op.body, title: name }, meta: { ...op.meta, title: name } };
    await this.store.updateOp(next);
    return next.meta;
  }

  /** Pasted files not on the server yet, as addresses this tab can show them from. */
  private readonly fileUrls = new Map<string, string>();

  /**
   * Keeps a pasted or dropped file on this device until the server has it, and answers the
   * id the page refers to it by (`asset:<id>`), so pasting works offline too.
   */
  async addFile(file: Blob, name: string): Promise<string> {
    const id = uuidv7();
    await this.store.addOp({ kind: 'uploadFile', id, name: name.slice(0, 200) || 'file', file });
    this.fileUrls.set(id, URL.createObjectURL(file));
    this.kick();
    return id;
  }

  /** Where this tab can show a file that waits to be sent; null once the server has it. */
  async localFile(id: string): Promise<string | null> {
    const known = this.fileUrls.get(id);
    if (known) return known;
    const ops = await this.store.ops().catch(() => []);
    const op = ops.find((o) => o.kind === 'uploadFile' && o.id === id);
    if (op?.kind !== 'uploadFile') return null;
    const url = URL.createObjectURL(op.file);
    this.fileUrls.set(id, url);
    return url;
  }

  uploaded(): void {
    // Nothing to do: a page showing the local copy keeps it, and it is the same file.
  }

  /** The tree changed in this tab: the other tabs reload it. */
  treeChanged(): void {
    this.post({ t: 'tree' });
  }

  /** Sends these pages' changes now, from this tab (before they are deleted, say). */
  async saveNow(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.docs.get(id)?.persist();
      const record = await this.store.get(id).catch(() => undefined);
      if (record?.dirty && !record.conflict) await this.sender.save(record).catch(() => undefined);
    }
  }

  /** Drops the local copies of pages deleted here. */
  async forget(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.store.update(id, () => null).catch(() => undefined);
      this.changed(id, undefined);
    }
  }

  // SenderHost, DocHost, LiveHost

  kick(): void {
    if (this.stopped) return;
    if (this.leader) void this.sender.kick();
    else this.post({ t: 'kick' });
  }

  changed(id: string, record: Parameters<PageDoc['take']>[0]): void {
    this.docs.get(id)?.take(record);
    this.post({ t: 'record', id });
  }

  announce(id: string): void {
    this.post({ t: 'record', id });
    if (this.leader) this.recountSoon();
  }

  private recountTimer: ReturnType<typeof setTimeout> | undefined;
  private treeTimer: ReturnType<typeof setTimeout> | undefined;
  private treeAgain = false;

  /** Keeps the tree for starting offline: at once, then at most every second while it changes. */
  private keepTreeSoon() {
    if (!this.store.durable) return;
    if (this.treeTimer) {
      this.treeAgain = true;
      return;
    }
    const tree = this.queryClient.getQueryData<Tree>(treeKey);
    if (tree && !this.stopped) void this.store.write('tree', tree).catch(() => undefined);
    this.treeTimer = setTimeout(() => {
      this.treeTimer = undefined;
      if (this.treeAgain) {
        this.treeAgain = false;
        this.keepTreeSoon();
      }
    }, TREE_WRITE_MS);
  }

  /** Keeps the number of waiting changes current while tabs write (at most every 150 ms). */
  private recountSoon() {
    this.recountTimer ??= setTimeout(() => {
      this.recountTimer = undefined;
      void this.sender.recount();
    }, 150);
  }

  confirmed(id: string, result: ContentSaved): void {
    const { [id]: _, ...refused } = this.shared().refused;
    this.setShared({ savedAt: { ...this.shared().savedAt, [id]: Date.now() }, refused });
    this.mergeTree(result);
    const event: ServerEvent = {
      type: 'page.updated',
      page: result.pages[0],
      revision: result.revision,
      origin: null,
    };
    this.post({ t: 'event', event });
  }

  applyTree(changes: TreeChanges): void {
    this.mergeTree(changes);
    // Reloaded everywhere, so the tree kept for offline use has it too.
    void this.queryClient.invalidateQueries({ queryKey: treeKey });
    this.post({ t: 'tree' });
  }

  inboxId(): string | undefined {
    return this.queryClient.getQueryData<Tree>(treeKey)?.inboxId;
  }

  titleOf(id: string): string {
    const page = this.queryClient.getQueryData<Tree>(treeKey)?.pages.find((p) => p.id === id);
    return page?.title || 'Untitled page';
  }

  async ensureSession(): Promise<void> {
    if (hasCsrfToken()) return;
    const signedIn = await this.options.refreshSession();
    if (!signedIn) throw new ApiRequestError(401, 'unauthenticated', 'Signed out.');
    // Still no token: the check came from the offline copy. Try again later.
    if (!hasCsrfToken()) throw new ApiRequestError(0, 'network', 'Can’t reach Memora.');
  }

  setShared(patch: Partial<Shared>): void {
    useSync.getState().setShared(patch);
    if (this.leader) this.post({ t: 'shared', shared: this.shared() });
  }

  shared(): Shared {
    const {
      reachable,
      connection,
      saving,
      pending,
      counted,
      conflicts,
      savedAt,
      refused,
      devices,
    } = useSync.getState();
    return {
      reachable,
      connection,
      saving,
      pending,
      counted,
      conflicts,
      savedAt,
      refused,
      devices,
    };
  }

  recovered(title: string): void {
    toast({
      title: `“${title}” was deleted elsewhere`,
      description: 'Your changes were saved as a new page in the Inbox.',
      tone: 'error',
    });
  }

  failed(message: string): void {
    toast({ title: message, tone: 'error' });
  }

  notify(message: string): void {
    toast(message);
  }

  storageFailed(error: unknown): void {
    const message = error instanceof Error ? error.name || error.message : 'failed';
    useSync.setState({ storageError: message });
  }

  reached(): void {
    if (!this.shared().reachable) this.setShared({ reachable: true });
  }

  unreachable(): void {
    if (this.shared().reachable) this.setShared({ reachable: false });
  }

  event(event: ServerEvent): void {
    this.handle(event);
    this.post({ t: 'event', event });
  }

  opened(): void {
    this.kick();
    this.catchUp();
  }

  catchUp(): void {
    void this.queryClient.invalidateQueries({ queryKey: treeKey });
    this.post({ t: 'tree' });
  }

  signedOut(): void {
    this.options.onSignedOut();
  }
}

// The engine of the signed-in user.

interface EngineState {
  engine: SyncEngine | null;
}

export const useEngine = create<EngineState>()(() => ({ engine: null }));

let starting: Promise<SyncEngine> | null = null;

/** Starts syncing for `userId` (once; again only after another user or signing out). */
export function startSync(
  userId: string,
  queryClient: QueryClient,
  options: EngineOptions,
): Promise<SyncEngine> {
  const current = useEngine.getState().engine;
  if (current?.userId === userId) return Promise.resolve(current);
  if (starting) return starting;
  starting = (async () => {
    await current?.stop();
    const engine = new SyncEngine(userId, await openStore(userId), queryClient, options);
    engine.start();
    useEngine.setState({ engine });
    return engine;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export async function stopSync(options: { forget?: boolean } = {}): Promise<void> {
  const engine = useEngine.getState().engine;
  useEngine.setState({ engine: null });
  await engine?.stop(options);
}

export const currentSync = (): SyncEngine | null => useEngine.getState().engine;

/** The row a new page gets before the server has answered. */
export function newPageMeta(
  body: CreatePageRequest & { id: string },
  sortKey: string,
  now: number,
): PageMeta {
  const type = body.type ?? 'markdown';
  return {
    id: body.id,
    sectionId: body.sectionId,
    parentPageId: body.parentPageId ?? null,
    title: (body.title ?? '').trim(),
    type,
    sortKey,
    snippet: type === 'markdown' ? snippetOf(markdownToText(body.content ?? '')) : '',
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
}
