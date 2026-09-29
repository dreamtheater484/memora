import {
  placeKeys,
  uuidv7,
  type CreateGroupRequest,
  type CreateNotebookRequest,
  type CreatePageRequest,
  type CreateSectionRequest,
  type DeleteResponse,
  type Notebook,
  type PageMeta,
  type PlacePagesRequest,
  type Section,
  type Settings,
  type TrashItem,
  type Tree,
  type TreeChanges,
  type UiState,
  type UpdateNotebookRequest,
  type UpdatePageRequest,
  type UpdateSectionRequest,
} from '@memora/shared';
import {
  queryOptions,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from '../components/ui';
import { ApiRequestError, api, errorMessage, isUnreachable } from '../lib/api';
import { currentSync, newPageMeta } from '../sync/engine';
import { settingsKey, treeKey } from './keys';
import {
  buildIndex,
  mergeChanges,
  planGroupMove,
  planNotebookMove,
  planPagesMove,
  planSectionMove,
  removeItems,
  type GroupPlace,
  type NotesIndex,
  type PagePlace,
  type SectionPlace,
} from './model';

export { settingsKey, treeKey };

/**
 * Loads something the app needs to start, with a copy kept on this device: without a
 * connection, the copy stands in (§9.6). The tree's copy is kept by the sync engine, which
 * follows every change to it.
 */
async function kept<T>(key: 'tree' | 'settings', load: () => Promise<T>): Promise<T> {
  const sync = currentSync();
  try {
    const value = await load();
    sync?.reached();
    if (key !== 'tree') void sync?.store.write(key, value).catch(() => undefined);
    return value;
  } catch (error) {
    if (!isUnreachable(error)) throw error;
    sync?.unreachable();
    const copy = await sync?.store.read<T>(key).catch(() => undefined);
    if (copy === undefined) throw error;
    return copy;
  }
}

export const treeQuery = queryOptions({
  queryKey: treeKey,
  queryFn: async () => {
    const tree = await kept('tree', () => api<Tree>('GET', '/tree'));
    // Pages made offline show until the server has them.
    return currentSync()?.overlay(tree) ?? tree;
  },
  staleTime: 30_000,
});

export const settingsQuery = queryOptions({
  queryKey: settingsKey,
  queryFn: () => kept('settings', () => api<Settings>('GET', '/settings')),
  staleTime: Infinity,
});

/** The notes tree with its lookups. Only below the notes route, which loads it first. */
export function useNotes(): NotesIndex {
  return useSuspenseQuery({ ...treeQuery, select: buildIndex }).data;
}

/** Per-user UI state, as far as it has loaded. */
export function useUiState(): UiState {
  return useQuery(settingsQuery).data?.ui ?? EMPTY_UI;
}
const EMPTY_UI: UiState = {};

// UI state is saved a moment after it changes, in one request.

let pendingUi: UiState | null = null;
let uiTimer: ReturnType<typeof setTimeout> | undefined;

export function saveUiState(queryClient: QueryClient, patch: UiState, delay = 800): void {
  queryClient.setQueryData<Settings>(settingsKey, (old) => {
    const ui = { ...old?.ui, ...patch };
    if (patch.lastPages) ui.lastPages = { ...old?.ui.lastPages, ...patch.lastPages };
    return { ui };
  });
  pendingUi = {
    ...pendingUi,
    ...patch,
    ...(patch.lastPages ? { lastPages: { ...pendingUi?.lastPages, ...patch.lastPages } } : {}),
  };
  clearTimeout(uiTimer);
  uiTimer = setTimeout(() => flushUiState(), delay);
}

export function flushUiState(): void {
  clearTimeout(uiTimer);
  const ui = pendingUi;
  pendingUi = null;
  // Losing a remembered position is harmless; no need to bother anyone.
  if (ui) api('PATCH', '/settings', { ui }).catch(() => undefined);
}

// Changes

export type NotesActions = ReturnType<typeof createNotesActions>;

const labelOf = (item: TrashItem, tree: Tree): string => {
  switch (item.type) {
    case 'notebook':
      return `“${tree.notebooks.find((n) => n.id === item.id)?.name ?? 'Notebook'}”`;
    case 'group':
      return `“${tree.groups.find((g) => g.id === item.id)?.name ?? 'Section group'}”`;
    case 'section':
      return `“${tree.sections.find((s) => s.id === item.id)?.name ?? 'Section'}”`;
    case 'page':
      return `“${tree.pages.find((p) => p.id === item.id)?.title || 'Untitled page'}”`;
  }
};

/**
 * Every change to the notes tree. Moves, renames and deletes show at once and are then
 * replaced by the server's answer; anything that needs a new id waits for the server. Requests
 * go out one at a time, in order, so the server sees changes in the order they were made.
 * A failure shows a toast and reloads the tree.
 */
export function createNotesActions(queryClient: QueryClient) {
  let queue: Promise<unknown> = Promise.resolve();
  // Changes shown before the server answered. Each answer is laid under the ones still
  // waiting, so an earlier answer cannot bring back a page deleted since, for example.
  const pending = new Set<(t: Tree) => Tree>();
  const tree = () => queryClient.getQueryData<Tree>(treeKey);
  const index = () => {
    const t = tree();
    return t ? buildIndex(t) : null;
  };
  const setTree = (fn: (t: Tree) => Tree) =>
    queryClient.setQueryData<Tree>(treeKey, (t) => (t ? fn(t) : t));

  function change<T>(
    optimistic: TreeChanges | ((t: Tree) => Tree) | null,
    request: () => Promise<T>,
    apply: (t: Tree, result: T) => Tree,
  ): Promise<T | undefined> {
    const guess =
      optimistic &&
      (typeof optimistic === 'function' ? optimistic : (t: Tree) => mergeChanges(t, optimistic));
    if (guess) {
      void queryClient.cancelQueries({ queryKey: treeKey });
      pending.add(guess);
      setTree(guess);
    }
    const result = queue.then(request).then(
      (value) => {
        if (guess) pending.delete(guess);
        setTree((t) => [...pending].reduce((acc, fn) => fn(acc), apply(t, value)));
        // The browser's other tabs load the change too.
        currentSync()?.treeChanged();
        return value;
      },
      (error: unknown) => {
        if (guess) pending.delete(guess);
        toast({ title: errorMessage(error), tone: 'error' });
        void queryClient.invalidateQueries({ queryKey: treeKey });
        return undefined;
      },
    );
    queue = result;
    return result;
  }

  const send = (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => () =>
    api<TreeChanges>(method, path, body);

  /** Moves items to the recycle bin, with an Undo button. */
  async function remove(
    items: TrashItem[],
    request: () => Promise<DeleteResponse>,
  ): Promise<DeleteResponse | undefined> {
    const t = tree();
    const what = items.length === 1 && t ? labelOf(items[0]!, t) : `${items.length} pages`;
    const result = await change(
      (current) => removeItems(current, items),
      request,
      (x) => x,
    );
    if (result) {
      toast({
        title: `Moved ${what} to the recycle bin`,
        action: { label: 'Undo', onClick: () => void actions.restore(result.deleted) },
      });
    }
    return result;
  }

  const patch = <T extends { id: string }>(list: readonly T[], id: string, fields: Partial<T>) => {
    const row = list.find((x) => x.id === id);
    return row ? [{ ...row, ...fields }] : [];
  };

  const actions = {
    // Notebooks
    createNotebook: (input: CreateNotebookRequest) =>
      change(null, send('POST', '/notebooks', input), mergeChanges),
    updateNotebook: (id: string, fields: UpdateNotebookRequest) =>
      change(
        { notebooks: patch<Notebook>(tree()?.notebooks ?? [], id, fields as Partial<Notebook>) },
        send('PATCH', `/notebooks/${id}`, fields),
        mergeChanges,
      ),
    moveNotebook: (id: string, beforeId: string | null) => {
      const plan = index() && planNotebookMove(index()!, id, beforeId);
      return (
        plan && change(plan, send('POST', `/notebooks/${id}/move`, { beforeId }), mergeChanges)
      );
    },
    deleteNotebook: (id: string) =>
      remove([{ type: 'notebook', id }], () => api('DELETE', `/notebooks/${id}`)),

    // Section groups
    createGroup: (input: CreateGroupRequest) =>
      change(null, send('POST', '/groups', input), mergeChanges),
    renameGroup: (id: string, name: string) =>
      change(
        { groups: patch(tree()?.groups ?? [], id, { name }) },
        send('PATCH', `/groups/${id}`, { name }),
        mergeChanges,
      ),
    moveGroup: (id: string, to: GroupPlace) => {
      const plan = index() && planGroupMove(index()!, id, to);
      return plan && change(plan, send('POST', `/groups/${id}/move`, to), mergeChanges);
    },
    deleteGroup: (id: string) =>
      remove([{ type: 'group', id }], () => api('DELETE', `/groups/${id}`)),

    // Sections
    createSection: (input: CreateSectionRequest) =>
      change(null, send('POST', '/sections', input), mergeChanges),
    updateSection: (id: string, fields: UpdateSectionRequest) =>
      change(
        { sections: patch<Section>(tree()?.sections ?? [], id, fields as Partial<Section>) },
        send('PATCH', `/sections/${id}`, fields),
        mergeChanges,
      ),
    moveSection: (id: string, to: SectionPlace) => {
      const plan = index() && planSectionMove(index()!, id, to);
      return plan && change(plan, send('POST', `/sections/${id}/move`, to), mergeChanges);
    },
    deleteSection: (id: string) =>
      remove([{ type: 'section', id }], () => api('DELETE', `/sections/${id}`)),

    // Pages
    /**
     * Shows the page at once, with an id made here (D14). Without a connection it is kept on
     * this device and created when the server can be reached (§9.6).
     */
    createPage: (input: CreatePageRequest) => {
      const body = { ...input, id: input.id ?? uuidv7() };
      const siblings = (tree()?.pages ?? []).filter(
        (p) => p.sectionId === body.sectionId && p.parentPageId === (body.parentPageId ?? null),
      );
      const sortKey = placeKeys(siblings, body.beforeId ?? null)?.[0];
      const meta = sortKey ? newPageMeta(body, sortKey, Date.now()) : null;
      return change(
        meta && { pages: [meta] },
        async () => {
          try {
            return await api<TreeChanges>('POST', '/pages', body);
          } catch (error) {
            const sync = currentSync();
            if (!meta || !sync || !isUnreachable(error)) throw error;
            await sync.createOffline(body, meta);
            return { pages: [meta] } satisfies TreeChanges;
          }
        },
        mergeChanges,
      );
    },
    updatePage: (id: string, fields: UpdatePageRequest) => {
      return change(
        fields.title === undefined
          ? null
          : { pages: patch<PageMeta>(tree()?.pages ?? [], id, { title: fields.title.trim() }) },
        async () => {
          try {
            return await api<TreeChanges>('PATCH', `/pages/${id}`, fields);
          } catch (error) {
            // Made offline and not on the server yet: the name goes with its creation.
            const waiting =
              fields.title !== undefined &&
              (isUnreachable(error) || (error instanceof ApiRequestError && error.status === 404))
                ? await currentSync()?.renamePending(id, fields.title)
                : null;
            if (!waiting) throw error;
            return { pages: [waiting] } satisfies TreeChanges;
          }
        },
        mergeChanges,
      );
    },
    movePages: (ids: string[], to: PagePlace) => {
      const plan = index() && planPagesMove(index()!, ids, to);
      return (
        plan &&
        change(
          plan,
          send('POST', '/pages/move', { ids, ...to } satisfies PlacePagesRequest),
          mergeChanges,
        )
      );
    },
    copyPages: (ids: string[], to: PagePlace) =>
      change(null, send('POST', '/pages/copy', { ids, ...to }), mergeChanges),
    duplicatePage: (id: string) =>
      change(null, send('POST', `/pages/${id}/duplicate`), mergeChanges),
    deletePages: (ids: string[]) => {
      const i = index();
      // Pages inside another selected page go with it; only the outermost are named.
      const items = (
        i ? ids.filter((id) => !ids.some((o) => o !== id && isBelow(i, id, o))) : ids
      ).map((id): TrashItem => ({ type: 'page', id }));
      return remove(items, async () => {
        // Typed a moment ago: it goes to the recycle bin with the page.
        const sync = currentSync();
        await sync?.saveNow(ids);
        const result = await api<DeleteResponse>('POST', '/pages/delete', { ids });
        await sync?.forget(ids);
        return result;
      });
    },

    restore: (items: TrashItem[]) =>
      change(null, send('POST', '/trash/restore', { items }), mergeChanges),
  };
  return actions;
}

function isBelow(index: NotesIndex, id: string, ancestorId: string): boolean {
  for (let p = index.page.get(id)?.parentPageId; p; p = index.page.get(p)?.parentPageId) {
    if (p === ancestorId) return true;
  }
  return false;
}

export function useNotesActions(): NotesActions {
  const queryClient = useQueryClient();
  return useMemo(() => actionsFor(queryClient), [queryClient]);
}

// One set per query client, so the request queue is shared by every component.
const byClient = new WeakMap<QueryClient, NotesActions>();
function actionsFor(queryClient: QueryClient): NotesActions {
  let actions = byClient.get(queryClient);
  if (!actions) {
    actions = createNotesActions(queryClient);
    byClient.set(queryClient, actions);
  }
  return actions;
}
