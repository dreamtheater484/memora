import { useEffect, useSyncExternalStore } from 'react';
import type { DocSnapshot, PageDoc } from './doc';
import { useEngine } from './engine';
import { isOffline, useSync, type PageSaveState, type SyncState } from './status';

/*
 * React's view of the sync engine: open a page, follow its state, and derive what the save
 * indicators show (§9.6). "Saved" only ever means the server confirmed the text.
 */

/** Opens the page for as long as the component shows it. */
export function usePageDoc(id: string | null): PageDoc | null {
  const engine = useEngine((s) => s.engine);
  const doc = engine && id ? engine.doc(id) : null;
  useEffect(() => {
    if (!engine || !doc) return;
    engine.retain(doc);
    return () => engine.release(doc);
  }, [engine, doc]);
  return doc;
}

const noSubscription = () => () => {};
const noSnapshot = () => null;

export function useDocSnapshot(doc: PageDoc | null): DocSnapshot | null {
  return useSyncExternalStore(
    doc ? doc.subscribe : noSubscription,
    doc ? doc.getSnapshot : noSnapshot,
  );
}

type Status = Pick<
  SyncState,
  | 'online'
  | 'reachable'
  | 'durable'
  | 'saving'
  | 'refused'
  | 'pending'
  | 'counted'
  | 'conflicts'
  | 'unsaved'
>;

/**
 * One page's state; null while this browser doesn't have the page (loading, say), when there's
 * nothing to tell, and above all no "Saved" to claim.
 */
export function pageSaveState(
  snapshot: DocSnapshot | null,
  sync: Status,
  id: string,
): PageSaveState | null {
  const record = snapshot?.record;
  if (record?.conflict) return 'conflict';
  if (!snapshot?.unpersisted && !record?.dirty) return record ? 'saved' : null;
  if (snapshot?.fallback || !sync.durable) return 'failed';
  if (record && sync.refused[id] === record.writeId) return 'failed';
  if (sync.saving.includes(id)) return 'saving';
  return isOffline(sync) ? 'local' : 'saving';
}

/** Everything in this browser together, for the app bar; null until the outbox is counted. */
export function globalSaveState(
  sync: Status & { storageError: string | null },
): PageSaveState | null {
  const waiting = sync.pending > 0 || sync.unsaved.length > 0 || sync.saving.length > 0;
  if (waiting && sync.storageError) return 'failed';
  if (sync.conflicts.length) return 'conflict';
  if (waiting) return isOffline(sync) ? 'local' : 'saving';
  return sync.counted ? 'saved' : null;
}

export function usePageSaveState(id: string, doc: PageDoc | null): PageSaveState | null {
  const snapshot = useDocSnapshot(doc);
  const sync = useSync();
  return pageSaveState(snapshot, sync, id);
}

export function useGlobalSaveState(): PageSaveState | null {
  return globalSaveState(useSync());
}
