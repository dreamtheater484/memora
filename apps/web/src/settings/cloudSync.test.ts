import type { SyncStatus } from '@memora/shared';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudSyncKey, cloudSyncShown } from './cloudSync';

const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  available: true,
  secureStorage: true,
  google: { available: true, ownClient: false },
  state: 'on',
  provider: 'kdrive',
  location: 'kDrive 1 › Memora',
  pending: null,
  paused: null,
  running: false,
  activity: null,
  lastSyncAt: null,
  lastError: null,
  waiting: 0,
  device: { id: 'd1', name: 'This computer' },
  devices: [],
  ...patch,
});

const sent: string[] = [];
vi.mock('../lib/api', () => ({
  api: (method: string, path: string) => {
    sent.push(`${method} ${path}`);
    return Promise.resolve(status({ running: true }));
  },
}));

describe('Memora shown again', () => {
  const now = 1_000_000;
  let client: QueryClient;

  beforeEach(() => {
    sent.length = 0;
    client = new QueryClient();
  });

  it('syncs the cloud folder at once', async () => {
    client.setQueryData(cloudSyncKey, status({ lastSyncAt: now - 60_000 }));
    cloudSyncShown(client, now);
    expect(sent).toEqual(['POST /sync/now']);
    await vi.waitFor(() =>
      expect(client.getQueryData<SyncStatus>(cloudSyncKey)?.running).toBe(true),
    );
  });

  it('leaves it when a run just ended, one is going on, or sync is off or paused', () => {
    for (const s of [
      status({ lastSyncAt: now - 2_000 }),
      status({ running: true }),
      status({ state: 'off', provider: null }),
      status({ state: 'paused', paused: 'signed_out' }),
    ]) {
      client.setQueryData(cloudSyncKey, s);
      cloudSyncShown(client, now);
    }
    expect(sent).toEqual([]);
  });

  it('does nothing without sync through a folder (Memora Server)', () => {
    cloudSyncShown(client, now);
    expect(sent).toEqual([]);
  });
});
