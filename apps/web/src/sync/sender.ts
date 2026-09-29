import {
  uuidv7,
  type ContentConflict,
  type ContentSaved,
  type PageType,
  type SaveContentRequest,
  type TreeChanges,
} from '@memora/shared';
import { ApiRequestError, api, isUnreachable, setCsrfToken } from '../lib/api';
import { absorb, newWriteId, rebase, saved, settle, type PageRecord } from './records';
import type { Shared } from './status';
import type { LocalStore, Op } from './store';

/*
 * Sends what waits in the store to the server (§9.6): tree changes made offline first, then
 * page content. A save names the revision it started from; the store only takes the answer
 * in when the server confirmed it. Refusals are dealt with here: a newer version elsewhere is
 * merged (or becomes a conflict, with this browser's side kept as a version), and a page
 * deleted elsewhere keeps its text as a new page in the Inbox. Nothing is ever dropped.
 *
 * Only the leader tab runs the loop; any tab can save one page directly (`save`).
 */

export interface SenderHost {
  readonly store: LocalStore;
  /** A record changed (or went): tell every tab. */
  changed(id: string, record: PageRecord | undefined): void;
  /** The server confirmed a save. */
  confirmed(id: string, result: ContentSaved): void;
  /** Tree rows the server answered with. */
  applyTree(changes: TreeChanges): void;
  inboxId(): string | undefined;
  titleOf(id: string): string;
  /** Makes sure changes can be sent (a CSRF token after starting offline). */
  ensureSession(): Promise<void>;
  setShared(patch: Partial<Shared>): void;
  shared(): Shared;
  /** A page's text now lives in a new page in the Inbox. */
  recovered(title: string): void;
  failed(message: string): void;
}

/** Longest wait between attempts while the server can't be reached. */
const MAX_DELAY_MS = 30_000;
/** Passes per run: merges ask for another pass, but never forever. */
const MAX_PASSES = 5;
/** Bodies small enough to finish after the tab has closed (the browser allows 64 KB). */
const KEEPALIVE_LIMIT = 30_000;

export class Sender {
  private running: Promise<void> | null = null;
  /** A pass asks for another (a merge to send, say). */
  private again = false;
  /** Something new came in while running. */
  private requested = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(private readonly host: SenderHost) {}

  /** Sends everything waiting. Resolves when this round is over (sent, or retrying later). */
  kick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) {
      this.requested = true;
      return this.running;
    }
    this.running = this.run().finally(() => {
      this.running = null;
      // It came in after the last pass (while counting, say): another round.
      if (this.requested && !this.stopped) void this.kick();
    });
    return this.running;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async run() {
    clearTimeout(this.timer);
    // Before anything is sent, which can take long: the indicator waits for the count.
    if (!this.host.shared().counted) await this.count();
    try {
      let passes = 0;
      do {
        this.again = this.requested = false;
        await this.pass();
      } while ((this.again || this.requested) && !this.stopped && ++passes < MAX_PASSES);
      this.attempt = 0;
      if (this.again) this.retryLater();
    } catch (error) {
      // Signed out: the login screen takes over, and the changes wait for the next sign-in.
      if (error instanceof ApiRequestError && error.status === 401) return;
      if (isUnreachable(error)) this.host.setShared({ reachable: false });
      else console.error('Saving failed', error);
      this.retryLater();
    } finally {
      await this.count();
    }
  }

  private retryLater() {
    if (this.stopped) return;
    const delay = Math.min(MAX_DELAY_MS, 1000 * 2 ** this.attempt) * (0.7 + Math.random() * 0.6);
    this.attempt += 1;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.kick(), delay);
  }

  private async count() {
    try {
      const records = await this.host.store.dirty();
      const conflicts = records.filter((r) => r.conflict).map((r) => r.id);
      const same =
        conflicts.length === this.host.shared().conflicts.length &&
        conflicts.every((id, i) => id === this.host.shared().conflicts[i]);
      if (!same) this.host.setShared({ conflicts });
      await this.recount();
    } catch {
      // Only the indicator's numbers.
    }
  }

  /** Updates the number of changes waiting (cheap: counts, doesn't read them). */
  async recount(): Promise<void> {
    try {
      const { dirty, ops } = await this.host.store.counts();
      const pending = dirty - this.host.shared().conflicts.length + ops;
      if (pending !== this.host.shared().pending || !this.host.shared().counted) {
        this.host.setShared({ pending, counted: true });
      }
    } catch {
      // As above: the pages' own indicators still know their state.
      if (!this.host.shared().counted) this.host.setShared({ counted: true });
    }
  }

  private async pass() {
    const { store } = this.host;
    const ops = await store.ops();
    const records = await store.dirty();
    if (!ops.length && !records.length) return;
    await this.host.ensureSession();
    for (const op of ops) await this.sendOp(op);
    for (const record of records) {
      if (this.stopped) return;
      if (record.conflict) {
        if (!record.conflict.kept) await this.keep(record);
        continue;
      }
      if (this.host.shared().refused[record.id] === record.writeId) continue;
      await this.save(record);
    }
  }

  /** Reached the server: say so (it may have been unreachable before). */
  private reached() {
    if (!this.host.shared().reachable) this.host.setShared({ reachable: true });
  }

  private saving(id: string, on: boolean) {
    const now = this.host.shared().saving;
    this.host.setShared({ saving: on ? [...now, id] : now.filter((x) => x !== id) });
  }

  /** Sends one page's content and takes in the answer. Throws when it should be retried. */
  async save(record: PageRecord, store: LocalStore = this.host.store): Promise<void> {
    const { id } = record;
    const sent = { writeId: record.writeId, content: record.content, revision: record.revision };
    const body: SaveContentRequest = {
      baseRevision: record.revision,
      content: record.content,
      ...(record.resolving ? { resolving: true } : {}),
    };
    const keepalive =
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden' &&
      record.content.length < KEEPALIVE_LIMIT;
    this.saving(id, true);
    try {
      const result = await api<ContentSaved>('PUT', `/pages/${id}/content`, body, { keepalive });
      this.reached();
      const after = await store.update(id, (r) => r && saved(r, sent, result.revision));
      // The record first, so open pages know the new revision is their own.
      this.host.changed(id, after);
      this.host.confirmed(id, result);
    } catch (error) {
      if (!(error instanceof ApiRequestError) || isUnreachable(error)) throw error;
      this.reached();
      if (error.code === 'revision_conflict') {
        const server = error.details as ContentConflict;
        const after = await store.update(
          id,
          (r) =>
            r &&
            (absorb(r, server) ?? (server.revision < r.revision ? rebase(r, server) : undefined)),
        );
        this.host.changed(id, after);
        // A merge is sent next; a conflict is kept as a version first.
        if (after?.dirty) this.again = true;
        return;
      }
      if (error.status === 404) {
        await this.recover(record.content, record.type, this.host.titleOf(id), store);
        await store.update(id, () => null);
        this.host.changed(id, undefined);
        return;
      }
      if (error.code === 'csrf_failed') setCsrfToken(null);
      if (error.status === 400 || error.status === 413) {
        // Won't be taken as it is (too long, say): wait for the next edit.
        this.host.setShared({ refused: { ...this.host.shared().refused, [id]: record.writeId } });
        this.host.failed(`“${this.host.titleOf(id)}” couldn’t be saved: ${error.message}`);
        return;
      }
      throw error;
    } finally {
      this.saving(id, false);
    }
  }

  /** Keeps this browser's side of a conflict as a version on the server. */
  private async keep(record: PageRecord) {
    try {
      await api('POST', `/pages/${record.id}/versions`, {
        reason: 'conflict',
        content: record.content,
        baseRevision: record.revision,
      });
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        await this.recover(record.content, record.type, this.host.titleOf(record.id));
        await this.host.store.update(record.id, () => null);
        this.host.changed(record.id, undefined);
        return;
      }
      throw error;
    }
    this.reached();
    // Kept once: typing on during the conflict doesn't make a version per save. "Keep
    // theirs" keeps the latest text again if it changed since.
    const after = await this.host.store.update(record.id, (r) =>
      r?.conflict ? { ...r, conflict: { ...r.conflict, kept: record.writeId } } : undefined,
    );
    this.host.changed(record.id, after);
  }

  private async sendOp(op: Op) {
    try {
      if (op.kind === 'createPage') {
        this.host.applyTree(await api<TreeChanges>('POST', '/pages', op.body));
      } else {
        await api('POST', `/pages/${op.pageId}/versions`, {
          reason: 'conflict',
          content: op.content,
          baseRevision: op.baseRevision,
        });
      }
      this.reached();
    } catch (error) {
      if (
        !(error instanceof ApiRequestError) ||
        isUnreachable(error) ||
        error.status === 401 ||
        error.code === 'csrf_failed'
      ) {
        if (error instanceof ApiRequestError && error.code === 'csrf_failed') setCsrfToken(null);
        throw error;
      }
      this.reached();
      await this.refusedOp(op, error);
    }
    await this.host.store.removeOp(op.seq!);
  }

  /** The server won't take an op as it is: put its content somewhere it will. */
  private async refusedOp(op: Op, error: ApiRequestError) {
    if (op.kind === 'keepVersion') {
      if (error.status === 404) {
        await this.recover(op.content, 'markdown', this.host.titleOf(op.pageId));
      }
      return;
    }
    // A page made offline whose section went meanwhile: it goes to the Inbox instead.
    const inboxId = this.host.inboxId();
    if (inboxId && op.body.sectionId !== inboxId) {
      const { beforeId: _, ...body } = op.body;
      this.host.applyTree(
        await api<TreeChanges>('POST', '/pages', {
          ...body,
          sectionId: inboxId,
          parentPageId: null,
        }),
      );
      return;
    }
    this.host.failed(`“${op.meta.title || 'Untitled page'}” couldn’t be created: ${error.message}`);
  }

  /** Saves text whose page is gone as a new page in the Inbox. */
  private async recover(
    content: string,
    type: PageType,
    title: string,
    store: LocalStore = this.host.store,
  ) {
    const inboxId = this.host.inboxId();
    if (!inboxId) throw new Error('The tree isn’t loaded yet.');
    const id = uuidv7();
    const name = `${title} (recovered)`.slice(0, 200);
    this.host.applyTree(
      await api<TreeChanges>('POST', '/pages', { id, sectionId: inboxId, title: name, type }),
    );
    // A new page is empty at revision 1; the text follows as a normal save.
    await store.update(id, () =>
      settle({
        id,
        type,
        revision: 1,
        base: '',
        content,
        writeId: newWriteId(),
        writer: '',
        touchedAt: Date.now(),
      }),
    );
    this.host.recovered(title);
    this.again = true;
  }
}
