import type { SyncedPart, SyncStatus } from '@memora/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { settingsKey } from '../notes/keys';

/*
 * Sync through a cloud folder (ADR 0006, the desktop app): its state, kept current by the
 * server's `sync.status` events, and what to reload when sync brought in changes.
 */

export const cloudSyncKey = ['cloud-sync'] as const;

export const cloudSyncQuery = queryOptions({
  queryKey: cloudSyncKey,
  queryFn: () => api<SyncStatus>('GET', '/sync'),
  staleTime: 30_000,
});

/** A run started, ended or failed: the status as the server has it now. */
export function cloudSyncStatus(queryClient: QueryClient, status: SyncStatus): void {
  queryClient.setQueryData(cloudSyncKey, status);
}

/** Changes from other computers came in: what they touched loads again. */
export function cloudSynced(queryClient: QueryClient, parts: readonly SyncedPart[]): void {
  if (parts.includes('settings')) void queryClient.invalidateQueries({ queryKey: settingsKey });
  if (parts.includes('templates')) void queryClient.invalidateQueries({ queryKey: ['templates'] });
}
