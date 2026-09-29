import type { PresenceDevice } from '@memora/shared';
import { create } from 'zustand';

/*
 * What the save indicators, banners and hints show (§9.6). The leader tab owns the part
 * about the server (`Shared`) and tells the other tabs; each tab adds what only it knows.
 */

export type Connection = 'connecting' | 'live' | 'polling';

/** Kept by the tab that talks to the server, and copied to every other tab. */
export interface Shared {
  /** The last request reached Memora (false: offline, or the server is down). */
  reachable: boolean;
  /** How changes made elsewhere arrive: the live channel, or checking every 30 s. */
  connection: Connection;
  /** Pages being sent right now. */
  saving: string[];
  /** Pages and tree changes waiting to be sent. */
  pending: number;
  /** `pending` has been counted: until then, nothing can be called saved. */
  counted: boolean;
  /** Pages whose changes clash with another device's, waiting for a choice. */
  conflicts: string[];
  /** When the server last confirmed each page, this session. */
  savedAt: Record<string, number>;
  /** Pages the server refused, with its reason (a new edit tries again). */
  refused: Record<string, string>;
  /** The user's other signed-in browsers and the pages they have open. */
  devices: PresenceDevice[];
}

export interface SyncState extends Shared {
  /** The browser thinks it has a network (`navigator.onLine`). */
  online: boolean;
  /** Changes are kept on this device (false: IndexedDB is unavailable or failed). */
  durable: boolean;
  /** Why storing on this device failed, while it does. */
  storageError: string | null;
  /** Pages open in this tab with changes the server doesn't have yet. */
  unsaved: string[];
  setShared(shared: Partial<Shared>): void;
}

export const initialShared: Shared = {
  reachable: true,
  connection: 'connecting',
  saving: [],
  pending: 0,
  counted: false,
  conflicts: [],
  savedAt: {},
  refused: {},
  devices: [],
};

export const useSync = create<SyncState>()((set) => ({
  ...initialShared,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  durable: true,
  storageError: null,
  unsaved: [],
  setShared: (shared) => set(shared),
}));

/** The states of §9.6, in the order they win when several pages are combined. */
export type PageSaveState = 'saved' | 'saving' | 'local' | 'conflict' | 'failed';

const WEIGHT: Record<PageSaveState, number> = {
  saved: 0,
  saving: 1,
  local: 2,
  conflict: 3,
  failed: 4,
};

export const worst = (states: PageSaveState[]): PageSaveState =>
  states.reduce<PageSaveState>((a, b) => (WEIGHT[b] > WEIGHT[a] ? b : a), 'saved');

/** Can the server be reached, as far as this tab knows? */
export const isOffline = (s: Pick<SyncState, 'online' | 'reachable'>): boolean =>
  !s.online || !s.reachable;
