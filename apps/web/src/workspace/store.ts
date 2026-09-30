import { useEffect } from 'react';
import { create } from 'zustand';
import { useCurrentUser } from '../auth/queries';
import { useMediaQuery } from '../lib/useMediaQuery';
import { PANE_LIMIT, defaultWorkspace, tidy, type DeviceClass, type Workspace } from './model';

/*
 * The workspace of each device class (§9.12), kept on the device for the signed-in user: a
 * wide monitor and an ultra-wide one each keep their own panes. Named layouts are kept with
 * the user's settings instead, so they follow the user.
 */

/** Wide from 1920 px, ultra-wide from 3200 px (§9.12). */
export const WIDE_QUERY = '(min-width: 120rem)';
export const ULTRA_QUERY = '(min-width: 200rem)';

const KEY = 'memora.workspace.';

interface WorkspaceStore {
  userId: string | null;
  byClass: Partial<Record<DeviceClass, Workspace>>;
  /** Loads the user's workspaces kept on this device. */
  load: (userId: string) => void;
  change: (cls: DeviceClass, update: (ws: Workspace) => Workspace) => void;
}

function read(userId: string, cls: DeviceClass): Workspace | undefined {
  try {
    const raw = localStorage.getItem(`${KEY}${userId}.${cls}`);
    if (!raw) return undefined;
    const ws = JSON.parse(raw) as Workspace;
    if (!Array.isArray(ws.panes) || !Array.isArray(ws.sizes)) return undefined;
    return tidy(ws, PANE_LIMIT[cls]);
  } catch {
    return undefined;
  }
}

function write(userId: string, cls: DeviceClass, ws: Workspace) {
  try {
    localStorage.setItem(`${KEY}${userId}.${cls}`, JSON.stringify(ws));
  } catch {
    // Storage full or blocked: the workspace lasts until the tab closes.
  }
}

export const useWorkspaceStore = create<WorkspaceStore>()((set, get) => ({
  userId: null,
  byClass: {},
  load: (userId) => {
    if (get().userId === userId) return;
    set({ userId, byClass: { wide: read(userId, 'wide'), ultra: read(userId, 'ultra') } });
  },
  change: (cls, update) => {
    const { userId, byClass } = get();
    const current = byClass[cls];
    if (!current) return;
    const next = tidy(update(current), PANE_LIMIT[cls]);
    if (next === current) return;
    set({ byClass: { ...byClass, [cls]: next } });
    if (userId) write(userId, cls, next);
  },
}));

/** The device class of this window: wide, ultra-wide, or null (no panes beside the main one). */
export function useDeviceClass(): DeviceClass | null {
  const wide = useMediaQuery(WIDE_QUERY);
  const ultra = useMediaQuery(ULTRA_QUERY);
  return ultra ? 'ultra' : wide ? 'wide' : null;
}

/**
 * This window's workspace; a device class's first one starts with the first board beside the
 * notes on ultra-wide screens (undefined while the boards are loading). Null below the wide
 * breakpoint.
 */
export function useWorkspace(firstBoardId: string | null | undefined): {
  cls: DeviceClass | null;
  ws: Workspace | null;
} {
  const cls = useDeviceClass();
  const user = useCurrentUser();
  const ws = useWorkspaceStore((s) => (cls ? s.byClass[cls] : undefined));
  const loaded = useWorkspaceStore((s) => s.userId === user.id);
  useEffect(() => {
    useWorkspaceStore.getState().load(user.id);
  }, [user.id]);
  useEffect(() => {
    if (!cls || !loaded || ws || firstBoardId === undefined) return;
    const store = useWorkspaceStore.getState();
    const made = defaultWorkspace(cls, firstBoardId);
    useWorkspaceStore.setState({ byClass: { ...store.byClass, [cls]: made } });
    write(user.id, cls, made);
  }, [cls, loaded, ws, firstBoardId, user.id]);
  return { cls, ws: cls ? (ws ?? null) : null };
}

/** Changes this window's workspace. */
export function changeWorkspace(cls: DeviceClass, update: (ws: Workspace) => Workspace): void {
  useWorkspaceStore.getState().change(cls, update);
}
