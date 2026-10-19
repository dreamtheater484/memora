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

/** A run a moment ago is recent enough when Memora is shown again. */
const SHOWN_AFTER_MS = 10_000;

/**
 * Memora is shown again (its window restored, the app back in front): sync at once, rather than
 * at the next run, so what changed meanwhile on the other devices shows straight away.
 */
export function cloudSyncShown(queryClient: QueryClient, now = Date.now()): void {
  const status = queryClient.getQueryData<SyncStatus>(cloudSyncKey);
  if (status?.state !== 'on' || status.running) return;
  if (status.lastSyncAt && now - status.lastSyncAt < SHOWN_AFTER_MS) return;
  api<SyncStatus>('POST', '/sync/now').then(
    (next) => cloudSyncStatus(queryClient, next),
    () => undefined,
  );
}

/** Changes from other computers came in: what they touched loads again. */
export function cloudSynced(queryClient: QueryClient, parts: readonly SyncedPart[]): void {
  if (parts.includes('settings')) void queryClient.invalidateQueries({ queryKey: settingsKey });
  if (parts.includes('templates')) void queryClient.invalidateQueries({ queryKey: ['templates'] });
}
