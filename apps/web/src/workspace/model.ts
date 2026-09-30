import {
  MAX_PANES,
  MAX_TABS,
  type PaneKind,
  type PaneTabSpec,
  type WorkspaceLayout,
} from '@memora/shared';

/*
 * The workspace on wide screens (§9.12): the main pane (what the address shows) and panes
 * beside it, each with tabs. Every change here is a pure function of the workspace, so the
 * rules can be tested on their own; the store keeps the result per device class.
 */

export interface PaneTab extends PaneTabSpec {
  id: string;
}

export interface Pane {
  id: string;
  tabs: PaneTab[];
  /** The tab shown, or null for an empty pane. */
  active: string | null;
}

export interface Workspace {
  panes: Pane[];
  /** Shares of the width in percent, the main pane first; they add up to 100. */
  sizes: number[];
}

/** Wide screens hold one pane beside the main one; ultra-wide ones up to three. */
export type DeviceClass = 'wide' | 'ultra';
export const PANE_LIMIT: Record<DeviceClass, number> = { wide: 1, ultra: MAX_PANES };

/** The narrowest a pane may be made, in percent of the row. */
export const MIN_SHARE = 12;

let counter = 0;
export const newId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const EMPTY: Workspace = { panes: [], sizes: [100] };

const round = (n: number) => Math.round(n * 10) / 10;

/** Equal shares, the main pane taking a larger one while there are only one or two panes. */
export function evenSizes(panes: number): number[] {
  if (panes === 0) return [100];
  const main = panes === 1 ? 56 : panes === 2 ? 44 : 100 / (panes + 1);
  const rest = (100 - main) / panes;
  return [round(main), ...Array.from({ length: panes }, () => round(rest))];
}

/** Sizes that fit `panes` panes, keeping the existing proportions where they can. */
function fitSizes(sizes: number[], panes: number, insertAt?: number): number[] {
  if (sizes.length === panes + 1) return sizes;
  if (sizes.length > panes + 1) return normalise(sizes.slice(0, panes + 1));
  // A new pane takes an even share; the others shrink in proportion.
  const share = 100 / (panes + 1);
  const scaled = sizes.map((s) => (s * (100 - share)) / 100);
  scaled.splice(insertAt ?? scaled.length, 0, share);
  return normalise(scaled);
}

function normalise(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => round((s / total) * 100));
}

export const tabOf = (spec: PaneTabSpec): PaneTab => ({ ...spec, id: newId('tab') });

const sameThing = (a: PaneTabSpec, b: PaneTabSpec) => a.kind === b.kind && a.target === b.target;

/** Adds a pane after `after` (a pane id; the main pane when missing), with these tabs. */
export function withPane(
  ws: Workspace,
  tabs: PaneTabSpec[],
  limit: number,
  after?: string | null,
): Workspace {
  if (ws.panes.length >= limit) return ws;
  const pane: Pane = { id: newId('pane'), tabs: tabs.map(tabOf), active: null };
  pane.active = pane.tabs[0]?.id ?? null;
  const at = after ? ws.panes.findIndex((p) => p.id === after) + 1 : 0;
  const panes = [...ws.panes];
  panes.splice(at, 0, pane);
  return { panes, sizes: fitSizes(ws.sizes, panes.length, at + 1) };
}

export function withoutPane(ws: Workspace, paneId: string): Workspace {
  const index = ws.panes.findIndex((p) => p.id === paneId);
  if (index < 0) return ws;
  const sizes = [...ws.sizes];
  // Its width goes to the neighbour on its left.
  const [freed] = sizes.splice(index + 1, 1);
  sizes[index] = (sizes[index] ?? 0) + (freed ?? 0);
  return { panes: ws.panes.filter((p) => p.id !== paneId), sizes: normalise(sizes) };
}

/** Shows `spec` in a pane: its tab when it has one already, else a new tab after the shown one. */
export function withTab(ws: Workspace, paneId: string, spec: PaneTabSpec): Workspace {
  return {
    ...ws,
    panes: ws.panes.map((pane) => {
      if (pane.id !== paneId) return pane;
      const existing = pane.tabs.find((t) => sameThing(t, spec));
      if (existing) return { ...pane, active: existing.id };
      const tab = tabOf(spec);
      const tabs = [...pane.tabs];
      const at = pane.active ? tabs.findIndex((t) => t.id === pane.active) + 1 : tabs.length;
      tabs.splice(at, 0, tab);
      // A full pane lets go of its oldest tab that isn't shown.
      while (tabs.length > MAX_TABS) tabs.splice(tabs[0]!.id === tab.id ? 1 : 0, 1);
      return { ...pane, tabs, active: tab.id };
    }),
  };
}

/** Closes a tab; the one next to it is shown. An emptied pane stays, offering what to open. */
export function withoutTab(ws: Workspace, tabId: string): Workspace {
  return {
    ...ws,
    panes: ws.panes.map((pane) => {
      const index = pane.tabs.findIndex((t) => t.id === tabId);
      if (index < 0) return pane;
      const tabs = pane.tabs.filter((t) => t.id !== tabId);
      const active =
        pane.active === tabId ? (tabs[index]?.id ?? tabs[index - 1]?.id ?? null) : pane.active;
      return { ...pane, tabs, active };
    }),
  };
}

export function withActive(ws: Workspace, paneId: string, tabId: string): Workspace {
  return {
    ...ws,
    panes: ws.panes.map((p) => (p.id === paneId ? { ...p, active: tabId } : p)),
  };
}

/** Changes what a tab shows (a search as it is typed). */
export function withTarget(ws: Workspace, tabId: string, target: string | null): Workspace {
  return {
    ...ws,
    panes: ws.panes.map((pane) =>
      pane.tabs.some((t) => t.id === tabId)
        ? { ...pane, tabs: pane.tabs.map((t) => (t.id === tabId ? { ...t, target } : t)) }
        : pane,
    ),
  };
}

export function findTab(ws: Workspace, tabId: string): { pane: Pane; tab: PaneTab } | null {
  for (const pane of ws.panes) {
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (tab) return { pane, tab };
  }
  return null;
}

/**
 * Moves a tab into a pane's tabs at `index` (the end when missing), and shows it there. A pane
 * its last tab leaves closes.
 */
export function movedTab(ws: Workspace, tabId: string, paneId: string, index?: number): Workspace {
  const found = findTab(ws, tabId);
  if (!found) return ws;
  let without = withoutTab(ws, tabId);
  if (found.pane.id !== paneId && found.pane.tabs.length === 1) {
    without = withoutPane(without, found.pane.id);
  }
  return {
    ...without,
    panes: without.panes.map((pane) => {
      if (pane.id !== paneId) return pane;
      const tabs = pane.tabs.filter((t) => !sameThing(t, found.tab));
      tabs.splice(Math.min(index ?? tabs.length, tabs.length), 0, found.tab);
      return { ...pane, tabs: tabs.slice(-MAX_TABS), active: found.tab.id };
    }),
  };
}

/**
 * Splits with a tab: a new pane beside `paneId` (`main` for the main pane) showing it, taken
 * from where it was. With no room for another pane, nothing changes.
 */
export function splitWith(
  ws: Workspace,
  tabId: string,
  paneId: string,
  side: 'before' | 'after',
  limit: number,
): Workspace {
  const found = findTab(ws, tabId);
  if (!found) return ws;
  const source = found.pane;
  // A pane's only tab dropped beside that pane: nothing to split.
  if (source.tabs.length === 1 && source.id === paneId) return ws;
  let next = withoutTab(ws, tabId);
  // A pane the move leaves empty closes, which frees a place.
  if (source.tabs.length === 1) next = withoutPane(next, source.id);
  if (next.panes.length >= limit) return ws;
  // Beside the main pane means right after it: the main pane stays first.
  let after: string | null = null;
  if (paneId !== 'main') {
    const index = next.panes.findIndex((p) => p.id === paneId);
    if (index < 0) return ws;
    after = side === 'after' ? paneId : (next.panes[index - 1]?.id ?? null);
  }
  return withPane(next, [found.tab], limit, after);
}

/** Moves the divider after share `index` by `delta` percent, within the limits. */
export function resized(ws: Workspace, index: number, delta: number): Workspace {
  const sizes = [...ws.sizes];
  const a = sizes[index];
  const b = sizes[index + 1];
  if (a === undefined || b === undefined) return ws;
  const moved = Math.max(MIN_SHARE - a, Math.min(delta, b - MIN_SHARE));
  sizes[index] = round(a + moved);
  sizes[index + 1] = round(b - moved);
  return { ...ws, sizes };
}

/** Drops panes past the device's limit. */
export function tidy(ws: Workspace, limit: number): Workspace {
  if (ws.panes.length <= limit && ws.sizes.length === ws.panes.length + 1) return ws;
  const panes = ws.panes.slice(0, limit);
  return { panes, sizes: fitSizes(ws.sizes, panes.length) };
}

export function toLayout(ws: Workspace, name: string): WorkspaceLayout {
  return {
    name,
    panes: ws.panes.map((pane) => ({
      tabs: pane.tabs.map(({ kind, target }) => ({ kind, target })),
      active: Math.max(
        0,
        pane.tabs.findIndex((t) => t.id === pane.active),
      ),
    })),
    sizes: ws.sizes,
  };
}

export function fromLayout(layout: WorkspaceLayout, limit: number): Workspace {
  const panes = layout.panes.slice(0, limit).map((spec) => {
    const tabs = spec.tabs.map(tabOf);
    return { id: newId('pane'), tabs, active: tabs[spec.active]?.id ?? tabs[0]?.id ?? null };
  });
  const sizes =
    layout.sizes.length === panes.length + 1 ? normalise(layout.sizes) : evenSizes(panes.length);
  return { panes, sizes };
}

/** A new device's workspace: nothing extra on wide screens; a board and an open pane on ultra-wide. */
export function defaultWorkspace(cls: DeviceClass, boardId: string | null): Workspace {
  if (cls === 'wide') return EMPTY;
  const panes: Pane[] = [
    { id: newId('pane'), tabs: [], active: null },
    ...(boardId ? [{ id: newId('pane'), tabs: [], active: null }] : []),
  ];
  if (boardId) {
    const tab = tabOf({ kind: 'board', target: boardId });
    panes[1] = { ...panes[1]!, tabs: [tab], active: tab.id };
  }
  return { panes, sizes: evenSizes(panes.length) };
}

/** What a new pane opened from the main pane shows: the same page or board. */
export function specOfMain(
  pageId: string | null | undefined,
  boardId: string | null | undefined,
): PaneTabSpec | null {
  if (pageId) return { kind: 'page', target: pageId };
  if (boardId) return { kind: 'board', target: boardId };
  return null;
}

export const KIND_NAMES: Record<PaneKind, string> = {
  page: 'Page',
  board: 'Board',
  search: 'Search',
  backlinks: 'Backlinks',
  history: 'History',
};
