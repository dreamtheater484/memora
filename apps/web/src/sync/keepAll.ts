import type { Page, Tree } from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';
import { api, isUnreachable } from '../lib/api';
import { treeQuery } from '../notes/queries';
import { useEngine, type SyncEngine } from './engine';
import { absorb, fromServer } from './records';

/*
 * "Keep every page on this device" (Phase 11): besides the pages opened lately, which are
 * always kept, the latest version of every page is fetched in the background and stored, so
 * everything opens without a connection. A setting of this device, not of the user.
 */

const KEY = 'memora.offline.keepAll';
/** A short pause every few pages, so a large collection doesn't hog the connection. */
const BATCH = 10;
const PAUSE_MS = 100;
/** Changes to the tree are caught up with this long after the last one. */
const SETTLE_MS = 2_000;

const readOn = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

interface KeepAllState {
  on: boolean;
  /** Pages checked and kept so far in this run, and in all. */
  done: number;
  total: number;
  setOn: (on: boolean) => void;
}

export const useKeepAll = create<KeepAllState>()((set) => ({
  on: readOn(),
  done: 0,
  total: 0,
  setOn: (on) => {
    try {
      if (on) localStorage.setItem(KEY, '1');
      else localStorage.removeItem(KEY);
    } catch {
      // Blocked storage: the setting lasts until the tab closes.
    }
    set({ on, done: 0, total: 0 });
  },
}));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetches and stores the pages this device doesn't have in their latest version. */
async function keep(engine: SyncEngine, tree: Tree, signal: AbortSignal): Promise<void> {
  const pages = tree.pages;
  useKeepAll.setState({ done: 0, total: pages.length });
  let done = 0;
  for (const meta of pages) {
    if (signal.aborted) return;
    const record = await engine.store.get(meta.id).catch(() => undefined);
    // Changes waiting to be sent are the sync engine's business.
    if (!record || (!record.dirty && record.revision < meta.revision)) {
      try {
        const page = await api<Page>('GET', `/pages/${meta.id}`);
        if (signal.aborted) return;
        let changed = false;
        await engine.store.update(meta.id, (r) => {
          // Kept pages count as long unopened, so they are the first to go if this is turned off.
          const next = r ? absorb(r, page) : fromServer(meta.id, page, 0);
          changed = !!next;
          return next;
        });
        if (changed) engine.announce(meta.id);
      } catch (error) {
        if (isUnreachable(error)) return;
        // A page deleted meanwhile: the next tree won't list it.
      }
      if (++done % BATCH === 0) await sleep(PAUSE_MS);
    } else {
      done += 1;
    }
    useKeepAll.setState({ done });
  }
}

/** Runs "keep every page" while it is on: one tab at a time, again when the tree changes. */
export function useKeepAllPages(): void {
  const on = useKeepAll((s) => s.on);
  // Pages are stored by the sync engine, which the notes start.
  const engine = useEngine((s) => s.engine);
  const tree = useQuery({ ...treeQuery, enabled: on && !!engine }).data;
  useEffect(() => {
    if (!on || !tree || !engine) return;
    const controller = new AbortController();
    const run = () => keep(engine, tree, controller.signal).catch(() => undefined);
    const timer = setTimeout(() => {
      // Tabs of this browser share the store: one of them is enough.
      if (navigator.locks) {
        void navigator.locks.request('memora-keep-all', { ifAvailable: true }, (lock) =>
          lock ? run() : undefined,
        );
      } else void run();
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [on, tree, engine]);
}
