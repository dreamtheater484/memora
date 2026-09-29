import type {
  ContentSaved,
  CreateVersionRequest,
  NameVersionRequest,
  PageVersion,
  PageVersionMeta,
  PurgeResult,
  RestoreToRequest,
  TrashItem,
  TrashList,
  TreeChanges,
  VersionKept,
} from '@memora/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { PageDoc } from '../sync/doc';
import { currentSync } from '../sync/engine';

/*
 * Version history and the recycle bin (§9.7), as the server keeps them. Both need a
 * connection: they are read when opened and not kept for offline use.
 */

export const versionsQuery = (pageId: string) =>
  queryOptions({
    queryKey: ['versions', pageId],
    queryFn: () => api<PageVersionMeta[]>('GET', `/pages/${pageId}/versions`),
    staleTime: 0,
  });

export const versionQuery = (pageId: string, versionId: string) =>
  queryOptions({
    queryKey: ['version', pageId, versionId],
    queryFn: () => api<PageVersion>('GET', `/pages/${pageId}/versions/${versionId}`),
    // A version never changes (its name aside, which the list has).
    staleTime: Infinity,
  });

export const trashQuery = queryOptions({
  queryKey: ['trash'],
  queryFn: () => api<TrashList>('GET', '/trash'),
  staleTime: 0,
});

/** Saves the page as it is now as a version, optionally named. */
export async function saveVersion(
  queryClient: QueryClient,
  doc: PageDoc,
  name?: string,
): Promise<VersionKept> {
  await doc.flush();
  if (!(await doc.whenSaved()))
    throw new Error('The page’s latest changes aren’t on the server yet.');
  const kept = await api<VersionKept>('POST', `/pages/${doc.id}/versions`, {
    reason: 'manual',
    ...(name?.trim() ? { name: name.trim() } : {}),
  } satisfies CreateVersionRequest);
  await queryClient.invalidateQueries({ queryKey: ['versions', doc.id] });
  return kept;
}

export async function nameVersion(
  queryClient: QueryClient,
  pageId: string,
  versionId: string,
  name: string | null,
): Promise<void> {
  await api<PageVersionMeta>('PATCH', `/pages/${pageId}/versions/${versionId}`, {
    name,
  } satisfies NameVersionRequest);
  await queryClient.invalidateQueries({ queryKey: ['versions', pageId] });
}

/**
 * Makes a version the page's content again. What was typed here is sent first (the server
 * keeps the page as it was as a version), and the page then follows the server.
 */
export async function restoreVersion(
  queryClient: QueryClient,
  doc: PageDoc,
  versionId: string,
): Promise<void> {
  await doc.flush();
  if (!(await doc.whenSaved()))
    throw new Error('The page’s latest changes aren’t on the server yet.');
  const saved = await api<ContentSaved>('POST', `/pages/${doc.id}/versions/${versionId}/restore`);
  await doc.refresh();
  currentSync()?.applyTree({ pages: saved.pages });
  await queryClient.invalidateQueries({ queryKey: ['versions', doc.id] });
}

/** "Restore as copy": a new page after this one; answers its id. */
export async function copyVersion(pageId: string, versionId: string): Promise<string | null> {
  const changes = await api<TreeChanges>('POST', `/pages/${pageId}/versions/${versionId}/copy`);
  currentSync()?.applyTree(changes);
  return changes.pages?.[0]?.id ?? null;
}

// Recycle bin

async function afterTrashChange(queryClient: QueryClient, changes?: TreeChanges) {
  if (changes) currentSync()?.applyTree(changes);
  await queryClient.invalidateQueries({ queryKey: ['trash'] });
}

export async function restoreItems(queryClient: QueryClient, items: TrashItem[]): Promise<void> {
  const changes = await api<TreeChanges>('POST', '/trash/restore', { items });
  await afterTrashChange(queryClient, changes);
}

export async function restoreTo(queryClient: QueryClient, request: RestoreToRequest) {
  const changes = await api<TreeChanges>('POST', '/trash/restore-to', request);
  await afterTrashChange(queryClient, changes);
  return changes;
}

export async function deleteForever(queryClient: QueryClient, items: TrashItem[]) {
  const result = await api<PurgeResult>('POST', '/trash/delete', { items });
  await afterTrashChange(queryClient);
  return result;
}

export async function emptyTrash(queryClient: QueryClient) {
  const result = await api<PurgeResult>('POST', '/trash/empty');
  await afterTrashChange(queryClient);
  return result;
}
