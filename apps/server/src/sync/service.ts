import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import {
  connectSyncSchema,
  uuidv7,
  type ServerEvent,
  type SyncConnected,
  type SyncDevice,
  type SyncedPart,
  type SyncPauseReason,
  type SyncProvider,
  type SyncStatus,
} from '@memora/shared';
import type { z } from 'zod';
import { assertStrongPassword } from '../auth/password';
import type { Config } from '../config';
import type { SqliteDatabase } from '../db/client';
import { dataIdOf } from '../db/meta';
import { ApiError } from '../errors';
import type { EventHub } from '../events/hub';
import type { NotesService } from '../notes/service';
import { installCapture, removeCapture } from './capture';
import {
  blobName,
  checkKeys,
  createVault,
  deriveKeys,
  parseVaultHeader,
  sealJson,
  seal,
  unlockVault,
  unseal,
  openJson,
  VAULT_FILE,
  VaultError,
  type VaultHeader,
  type VaultKdf,
  type VaultKeys,
} from './crypto';
import { SyncEngine, type Applied, type Incoming, type SnapshotPosition } from './engine';
import {
  batchSchema,
  blobFileName,
  changesName,
  deviceFileName,
  deviceSchema,
  FORMAT_VERSION,
  parseChangesName,
  parseDeviceName,
  parseSnapshotName,
  snapshotName,
  snapshotSchema,
  type Batch,
  type Change,
} from './format';
import { Hlc } from './hlc';
import {
  blobLimit,
  READ_LIMITS,
  RemoteError,
  VAULT_DIRS,
  type RemoteEntry,
  type RemoteStore,
} from './store';
import { FolderStore } from './stores/folder';
import {
  authorizationUrl,
  exchangeCode,
  GOOGLE_ENDPOINTS,
  GoogleDriveStore,
  GoogleTokens,
  pkce,
  type GoogleClient,
  type GoogleEndpoints,
} from './stores/gdrive';
import { kdriveUrl, WebDavStore } from './stores/webdav';
import { NO_SECRETS, type SecretStore, type SyncSecrets } from './secrets';
import { readTables, type Table } from './tables';

/*
 * Sync through a cloud folder (ADR 0006): setting it up, and the runs that send this
 * computer's changes and bring in the others'. Only in the desktop app.
 *
 * A run: read what other computers wrote since last time and merge it (pull), write a batch of
 * what changed here (push), and now and then a snapshot and this computer's record. Runs come
 * every few seconds while there are changes to send, and every minute otherwise.
 */

interface SyncConfig {
  provider: SyncProvider;
  /** WebDAV and kDrive: the folder's address. */
  url?: string;
  /** A folder on this computer. */
  path?: string;
  /** Google Drive: the folder's name in My Drive, and its id once found. */
  folder?: string;
  rootId?: string | null;
  location: string;
  vaultId: string;
  deviceId: string;
  deviceName: string;
  /** The database's data id when sync was set up: a restored backup has another. */
  dataId: string;
  /** Still reading the vault's notes for the first time. */
  joining: boolean;
  paused: SyncPauseReason | null;
}

interface RunState {
  /** The last batch this computer wrote. */
  seq: number;
  /** The last batch read from each other computer. */
  cursors: Record<string, number>;
  hlc: string | null;
  lastSyncAt: number | null;
  lastError: { message: string; at: number } | null;
  snapshotAt: number | null;
  sentSinceSnapshot: number;
  deviceRecordAt: number | null;
  /** When batches were written, for removing old ones: a few entries a day. */
  written: { seq: number; at: number }[];
  devices: SyncDevice[];
}

const NEW_RUN: RunState = {
  seq: 0,
  cursors: {},
  hlc: null,
  lastSyncAt: null,
  lastError: null,
  snapshotAt: null,
  sentSinceSnapshot: 0,
  deviceRecordAt: null,
  written: [],
  devices: [],
};

interface Pending {
  provider: SyncProvider;
  input: z.output<typeof connectSyncSchema> | null;
  store: RemoteStore | null;
  location: string | null;
  header: VaultHeader | null;
  vault: 'new' | 'existing' | null;
  /** Google: the sign-in in the browser. */
  google: {
    state: string;
    verifier: string;
    redirectUri: string;
    startedAt: number;
    status: 'waiting' | 'done' | 'failed';
    error: string | null;
    refreshToken: string | null;
    /** Signing in again for sync that is set up (not a new connection). */
    reconnect: boolean;
  } | null;
  rootId: string | null;
}

interface Context {
  config: SyncConfig;
  store: RemoteStore;
  keys: VaultKeys;
  engine: SyncEngine;
  hlc: Hlc;
}

export interface SyncLogger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface SyncOptions {
  db: SqliteDatabase;
  config: Config;
  events: EventHub;
  notes: NotesService;
  secrets: SecretStore;
  /** The system's folder picker (the desktop app's main process). */
  pickFolder?: () => Promise<string | null>;
  /** The desktop app's one account. */
  owner: () => string;
  log: SyncLogger;
  now: () => number;
  version: string;
  google?: { client: GoogleClient | null; endpoints?: GoogleEndpoints };
  /** Tests: WebDAV on http://127.0.0.1. */
  allowHttp?: boolean;
  /** Tests run each step themselves. */
  timers?: boolean;
  /** Tests make snapshots of several parts. */
  partBytes?: number;
  /** Tests: cheaper key settings for new vaults. */
  kdf?: VaultKdf;
}

const BATCH_LIMIT = 4000;
const PART_BYTES = 8_000_000;
/** Files fetched for one round of merging. */
const BLOB_BUDGET = 64 * 1024 * 1024;
/** Batches read per round of merging. */
const FILES_PER_ROUND = 40;
const SNAPSHOT_EVERY_CHANGES = 2000;
const SNAPSHOT_EVERY_MS = 7 * 24 * 3_600_000;
const KEEP_SNAPSHOTS = 2;
const KEEP_BATCHES_MS = 30 * 24 * 3_600_000;
const DEVICE_RECORD_EVERY_MS = 3_600_000;
/** How often the list of computers is read again (and at each "Sync now"). */
const DEVICE_LIST_EVERY_MS = 5 * 60_000;
/** How often other computers' changes are looked for: a listing of one folder. */
const PULL_EVERY_MS = 15_000;
/** How often the vault file is checked against the one this computer joined. */
const VAULT_CHECK_EVERY_MS = 10 * 60_000;
const TICK_MS = 5_000;
const PUSH_AFTER_MS = 4_000;
const SIGN_IN_TIMEOUT_MS = 15 * 60_000;

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');
/** A stored file's name: only files named so are ever removed from files/. */
const STORED_FILE = /^[0-9a-f]{64}\.mblob$/;

export class SyncService {
  private readonly db: SqliteDatabase;
  private tablesCache: Map<string, Table> | null = null;
  private pending: Pending | null = null;
  private context: Context | null = null;
  private running = false;
  private again = false;
  private activity: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** No run before this, unless there are changes to send. */
  private failures = 0;
  private nextRunAt = 0;
  private lastRunEndedAt = 0;
  private lastPullAt = 0;
  private vaultCheckedAt = 0;
  private devicesReadAt = 0;
  private secureStorage = false;
  private cleanupWanted = false;
  private stopped = false;
  /** Files of this run that couldn't be used: shown as the last problem when the run ends. */
  private problems: string[] = [];
  /** What the last part of each snapshot said (or that it can't be used): not read again. */
  private snapshotsSeen = new Map<
    string,
    { last: boolean; cursors: Record<string, number> } | 'bad'
  >();

  constructor(private readonly o: SyncOptions) {
    this.db = o.db;
  }

  get available(): boolean {
    return this.o.config.desktop !== null;
  }

  private get tables(): Map<string, Table> {
    this.tablesCache ??= readTables(this.db);
    return this.tablesCache;
  }

  // Stored state

  private read<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as
      { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    if (value === null) this.db.prepare('DELETE FROM sync_state WHERE key = ?').run(key);
    else {
      this.db
        .prepare(
          'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        )
        .run(key, JSON.stringify(value));
    }
  }

  private get config(): SyncConfig | null {
    return this.read<SyncConfig>('config');
  }

  private set config(value: SyncConfig | null) {
    this.write('config', value);
  }

  private get run(): RunState {
    return { ...NEW_RUN, ...(this.read<Partial<RunState>>('run') ?? {}) };
  }

  private updateRun(patch: Partial<RunState>): void {
    this.write('run', { ...this.run, ...patch });
  }

  // Life cycle

  /** At start: checks what the database says against the secrets, and starts running. */
  async start(): Promise<void> {
    // Sync is only for the desktop app (a database moved to a server lost its triggers before
    // the migrations ran: index.ts).
    if (!this.available) return;
    // Asked in the background: a keyring that is slow to answer mustn't hold up the start.
    void this.o.secrets
      .available()
      .catch(() => false)
      .then((available) => {
        this.secureStorage = available;
      });
    const config = this.config;
    if (!config) {
      removeCapture(this.db);
      return;
    }
    if (config.dataId !== dataIdOf(this.db) && config.paused !== 'restored') {
      this.config = { ...config, paused: 'restored' };
    }
    // Also while paused: what changes here meanwhile is sent once sync runs again.
    installCapture(this.db, this.tables.values());
    this.schedule(3_000);
  }

  /** Stops runs; with `flush`, sends what is waiting first (when Memora closes). */
  async stop(flush = false, timeoutMs = 5_000): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!flush || !this.available || !this.config || this.config.paused) return;
    const ctx = this.context;
    if (!ctx || ctx.engine.waiting() === 0) return;
    await Promise.race([
      this.waitIdle()
        .then(() => this.push(ctx))
        .catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, timeoutMs).unref()),
    ]);
  }

  private async waitIdle(): Promise<void> {
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 100));
  }

  /** Runs at the latest after `delay`; sooner when there are changes to send. */
  private schedule(delay: number): void {
    if (this.o.timers === false || this.stopped) return;
    this.nextRunAt = this.o.now() + delay;
    if (delay < TICK_MS) setTimeout(() => void this.tick(), Math.max(0, delay)).unref();
    if (!this.timer) {
      this.timer = setInterval(() => void this.tick(), TICK_MS);
      this.timer.unref();
    }
  }

  private async tick(): Promise<void> {
    const config = this.config;
    if (!config || config.paused || this.stopped) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      return;
    }
    if (this.running) return;
    const now = this.o.now();
    const changes =
      this.failures === 0 && now - this.lastRunEndedAt >= PUSH_AFTER_MS && this.waitingCount() > 0;
    if (now >= this.nextRunAt || changes) await this.runOnce();
  }

  private waitingCount(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM sync_dirty').get() as { n: number }).n;
  }

  /** Whether the notes here are complete enough to remove unused files (assets/cleanup.ts). */
  settled(): boolean {
    if (!this.available) return true;
    const config = this.config;
    if (!config) return true;
    const quiet =
      !this.running &&
      !config.joining &&
      !config.paused &&
      this.o.now() - this.lastPullAt < 10 * 60_000 &&
      (this.db.prepare('SELECT count(*) AS n FROM sync_parked').get() as { n: number }).n === 0;
    if (!quiet) this.cleanupWanted = true;
    return quiet;
  }

  /** Set by the maintenance job: removes unused files once sync has settled. */
  onCleanup: (() => void) | null = null;

  // Status

  status(): SyncStatus {
    const config = this.available ? this.config : null;
    const run = this.run;
    const pending = this.pending;
    const builtIn = this.o.google?.client ?? null;
    return {
      available: this.available,
      secureStorage: this.secureStorage,
      google: { available: !!(builtIn ?? this.ownGoogleClient), ownClient: !!this.ownGoogleClient },
      state: !config ? (pending ? 'connecting' : 'off') : config.paused ? 'paused' : 'on',
      provider: config?.provider ?? null,
      location: config?.location ?? null,
      pending: pending
        ? {
            provider: pending.provider,
            location: pending.location,
            vault: pending.vault,
            signIn: pending.google ? pending.google.status : null,
            signInError: pending.google?.error ?? null,
          }
        : null,
      paused: config?.paused ?? null,
      running: this.running,
      activity: this.activity,
      lastSyncAt: run.lastSyncAt,
      lastError: run.lastError,
      waiting: config ? this.waitingCount() : 0,
      device: config ? { id: config.deviceId, name: config.deviceName } : null,
      devices: config ? run.devices.map((d) => ({ ...d, current: d.id === config.deviceId })) : [],
    };
  }

  private publish(): void {
    if (!this.available) return;
    const event: ServerEvent = { type: 'sync.status', status: this.status() };
    try {
      this.o.events.publish(this.o.owner(), event);
    } catch {
      // No account yet: nobody to tell.
    }
  }

  private setActivity(activity: string | null): void {
    this.activity = activity;
    this.publish();
  }

  // Secrets

  private ownGoogleClient: GoogleClient | null = null;

  async loadSecrets(): Promise<SyncSecrets> {
    const secrets = await this.o.secrets.load().catch(() => NO_SECRETS);
    this.ownGoogleClient = secrets.googleClient;
    return secrets;
  }

  private googleClient(): GoogleClient {
    const client = this.ownGoogleClient ?? this.o.google?.client ?? null;
    if (!client) {
      throw new ApiError(
        409,
        'conflict',
        'This build of Memora can’t sign in to Google Drive. Use a Google Cloud client of your own (Advanced), or a folder that the Google Drive app keeps in sync.',
      );
    }
    return client;
  }

  private get endpoints(): GoogleEndpoints {
    return this.o.google?.endpoints ?? GOOGLE_ENDPOINTS;
  }

  /** Sets (or removes) a Google Cloud client of the person's own. */
  async setGoogleClient(client: GoogleClient | null): Promise<SyncStatus> {
    this.requireDesktop();
    const secrets = await this.loadSecrets();
    await this.saveSecrets({ ...secrets, googleClient: client });
    this.ownGoogleClient = client;
    return this.status();
  }

  private async saveSecrets(secrets: SyncSecrets): Promise<void> {
    if (!(await this.o.secrets.available().catch(() => false))) {
      this.secureStorage = false;
      throw new ApiError(
        409,
        'conflict',
        'This computer can’t keep the sign-in safely: it has no keyring (on Linux, install and unlock GNOME Keyring or KWallet). Use a folder on this computer instead, which needs no sign-in.',
      );
    }
    this.secureStorage = true;
    await this.o.secrets.save(secrets);
  }

  private requireDesktop(): void {
    if (!this.available) {
      throw new ApiError(
        404,
        'not_found',
        'Sync through a cloud folder is part of the desktop app.',
      );
    }
  }

  // Setting up

  /** Picks a folder with the system's dialog (desktop app only). */
  async pickFolder(): Promise<string | null> {
    this.requireDesktop();
    if (!this.o.pickFolder) return null;
    return this.o.pickFolder();
  }

  /** Starts signing in to Google in the browser; answers the address to open there. */
  async googleStart(): Promise<string> {
    this.requireDesktop();
    await this.loadSecrets();
    const client = this.googleClient();
    const config = this.config;
    const reconnect = !!config && config.provider === 'google';
    if (!reconnect && config) {
      throw new ApiError(409, 'conflict', 'Turn sync off before connecting to another folder.');
    }
    const { verifier, challenge } = pkce();
    const state = randomBytes(24).toString('base64url');
    const base = this.o.config.baseUrl ?? `http://127.0.0.1:${this.o.config.port}`;
    const redirectUri = `${new URL(base).origin}/api/v1/sync/google/callback`;
    const google = {
      state,
      verifier,
      redirectUri,
      startedAt: this.o.now(),
      status: 'waiting' as const,
      error: null,
      refreshToken: null,
      reconnect,
    };
    this.pending = reconnect
      ? {
          provider: 'google',
          input: null,
          store: null,
          location: config.location,
          header: null,
          vault: null,
          google,
          rootId: null,
        }
      : {
          provider: 'google',
          input: null,
          store: null,
          location: null,
          header: null,
          vault: null,
          google,
          rootId: null,
        };
    this.publish();
    return authorizationUrl(client, redirectUri, state, challenge, this.endpoints);
  }

  /**
   * Google sends the browser back here with a code (or an error). Answers a short message for
   * that browser tab.
   */
  async googleCallback(query: {
    code?: string;
    state?: string;
    error?: string;
  }): Promise<{ ok: boolean; message: string }> {
    const google = this.pending?.google;
    const fail = (message: string) => {
      if (google) {
        google.status = 'failed';
        google.error = message;
      }
      this.publish();
      return { ok: false, message };
    };
    if (!google || google.status !== 'waiting' || !query.state) {
      return {
        ok: false,
        message: 'This sign-in isn’t one Memora started. Start again in Memora.',
      };
    }
    const expected = Buffer.from(google.state);
    const got = Buffer.from(query.state);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
      return {
        ok: false,
        message: 'This sign-in isn’t one Memora started. Start again in Memora.',
      };
    }
    if (this.o.now() - google.startedAt > SIGN_IN_TIMEOUT_MS) {
      return fail('The sign-in took too long. Start again in Memora.');
    }
    if (query.error || !query.code) {
      return fail(
        query.error === 'access_denied'
          ? 'Google Drive wasn’t connected: access was declined.'
          : 'Google didn’t sign Memora in. Try again.',
      );
    }
    try {
      const token = await exchangeCode(
        this.googleClient(),
        query.code,
        google.verifier,
        google.redirectUri,
        this.endpoints,
      );
      google.refreshToken = token;
      google.status = 'done';
      if (google.reconnect) {
        const secrets = await this.loadSecrets();
        await this.saveSecrets({
          ...secrets,
          credentials: { kind: 'google', refreshToken: token },
        });
        this.pending = null;
        this.context = null;
        const config = this.config;
        if (config?.paused === 'signed_out') this.config = { ...config, paused: null };
        this.failures = 0;
        this.schedule(500);
      }
      this.publish();
      return { ok: true, message: 'Memora is connected to Google Drive. You can close this tab.' };
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'Google didn’t sign Memora in.');
    }
  }

  /** Reaches the folder, checks Memora may read and write there, and looks for a vault. */
  async connect(body: unknown): Promise<SyncConnected> {
    this.requireDesktop();
    if (this.config) {
      throw new ApiError(409, 'conflict', 'Sync is set up already. Turn it off first.');
    }
    const parsed = connectSyncSchema.safeParse(body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        fields[issue.path.join('.') || '_'] ??= issue.message;
      throw new ApiError(400, 'invalid_request', 'Some fields are not valid.', { fields });
    }
    const input = parsed.data;
    await this.loadSecrets();
    let store: RemoteStore;
    let location: string;
    let rootId: string | null = null;
    try {
      if (input.provider === 'folder') {
        store = await FolderStore.open(input.path);
        location = input.path;
      } else if (input.provider === 'google') {
        const token = this.pending?.google?.refreshToken;
        if (this.pending?.provider !== 'google' || !token) {
          throw new ApiError(409, 'conflict', 'Sign in to Google first.');
        }
        const drive = new GoogleDriveStore(
          new GoogleTokens(this.googleClient(), token, this.endpoints),
          input.folder,
          null,
          this.endpoints,
        );
        rootId = await drive.prepare();
        store = drive;
        location = drive.location;
      } else {
        const url =
          input.provider === 'kdrive' ? kdriveUrl(input.driveId, input.folder) : input.url;
        const dav = new WebDavStore({
          url,
          username: input.username,
          password: input.password,
          allowHttp: this.o.allowHttp,
        });
        await dav.prepare(input.provider === 'kdrive');
        store = dav;
        location =
          input.provider === 'kdrive'
            ? `kDrive ${input.driveId} › ${input.folder.split('/').join(' › ')}`
            : dav.location;
      }
      await probe(store);
      const data = await store.read(VAULT_FILE, READ_LIMITS.small);
      const header = data ? parseVaultHeader(data) : null;
      if (!header) await assertNoVaultFiles(store);
      this.pending = {
        provider: input.provider,
        input,
        store,
        location,
        header,
        vault: header ? 'existing' : 'new',
        google: this.pending?.google ?? null,
        rootId,
      };
      this.publish();
      return { vault: header ? 'existing' : 'new', location };
    } catch (error) {
      throw asApiError(error);
    }
  }

  /** Forgets a connection that wasn't finished. */
  cancel(): SyncStatus {
    this.requireDesktop();
    this.pending = null;
    this.publish();
    return this.status();
  }

  /**
   * Sets sync up with the passphrase: makes the vault (a new folder) or opens it (checking the
   * passphrase), keeps the secrets, and starts the first run.
   */
  async enable(passphrase: string): Promise<SyncStatus> {
    this.requireDesktop();
    const pending = this.pending;
    if (this.config) throw new ApiError(409, 'conflict', 'Sync is set up already.');
    if (!pending?.store || !pending.input) {
      throw new ApiError(409, 'conflict', 'Choose the folder first.');
    }
    let keys: VaultKeys;
    let header = pending.header;
    try {
      const now = await pending.store.read(VAULT_FILE, READ_LIMITS.small);
      const current = now ? parseVaultHeader(now) : null;
      if (current?.vaultId !== header?.vaultId) {
        throw new ApiError(
          409,
          'conflict',
          'The folder changed since you chose it: another computer set up sync there. Choose the folder again.',
        );
      }
      if (header) {
        keys = await unlockVault(header, passphrase).catch((error: unknown) => {
          if (error instanceof VaultError) {
            throw new ApiError(400, 'wrong_password', error.message, {
              fields: { passphrase: error.message },
            });
          }
          throw error;
        });
      } else {
        try {
          assertStrongPassword(passphrase, '');
        } catch (error) {
          if (error instanceof ApiError) {
            throw new ApiError(400, 'weak_password', error.message, {
              fields: { passphrase: error.message },
            });
          }
          throw error;
        }
        const made = await createVault(passphrase, this.o.now(), this.o.kdf);
        header = made.header;
        keys = made.keys;
      }
    } catch (error) {
      throw asApiError(error);
    }

    const input = pending.input;
    const secrets = await this.loadSecrets();
    await this.saveSecrets({
      ...secrets,
      vaultKey: keys.master.toString('base64'),
      credentials:
        input.provider === 'google'
          ? { kind: 'google', refreshToken: pending.google!.refreshToken! }
          : input.provider === 'folder'
            ? { kind: 'folder' }
            : { kind: 'webdav', username: input.username, password: input.password },
    });
    if (!pending.header) {
      // Written last: until then, a half-set-up folder is a new folder to the next computer.
      try {
        await pending.store.write(VAULT_FILE, Buffer.from(JSON.stringify(header, null, 2), 'utf8'));
      } catch (error) {
        throw asApiError(error);
      }
    }

    const deviceId = uuidv7(this.o.now());
    const engine = new SyncEngine({
      db: this.db,
      tables: this.tables,
      owner: this.o.owner(),
      deviceName: this.deviceName(),
      hlc: new Hlc(deviceId, this.o.now),
      now: this.o.now,
    });
    engine.reset();
    this.config = {
      provider: input.provider,
      ...(input.provider === 'folder' ? { path: input.path } : {}),
      ...(input.provider === 'google' ? { folder: input.folder, rootId: pending.rootId } : {}),
      ...(input.provider === 'kdrive' ? { url: kdriveUrl(input.driveId, input.folder) } : {}),
      ...(input.provider === 'webdav' ? { url: input.url } : {}),
      location: pending.location ?? '',
      vaultId: keys.vaultId,
      deviceId,
      deviceName: this.deviceName(),
      dataId: dataIdOf(this.db),
      joining: !!pending.header,
      paused: null,
    };
    this.write('run', NEW_RUN);
    installCapture(this.db, this.tables.values());
    // A new vault: everything here goes out in the first runs.
    if (!pending.header) engine.markUnsynced();
    this.pending = null;
    this.context = null;
    this.failures = 0;
    this.stopped = false;
    this.o.log.info({ provider: input.provider, joining: !!pending.header }, 'sync set up');
    this.publish();
    this.schedule(200);
    return this.status();
  }

  private deviceName(): string {
    return (os.hostname() || this.o.config.desktop?.name || 'This computer').slice(0, 100);
  }

  /** A new password for WebDAV or kDrive, after the old one stopped working. */
  async updatePassword(password: string): Promise<SyncStatus> {
    this.requireDesktop();
    const config = this.config;
    if (!config || (config.provider !== 'webdav' && config.provider !== 'kdrive') || !config.url) {
      throw new ApiError(409, 'conflict', 'This sync doesn’t use a password.');
    }
    const secrets = await this.loadSecrets();
    if (secrets.credentials?.kind !== 'webdav')
      throw new ApiError(409, 'conflict', 'Set sync up again.');
    const store = new WebDavStore({
      url: config.url,
      username: secrets.credentials.username,
      password,
      allowHttp: this.o.allowHttp,
    });
    try {
      await store.prepare();
      await probe(store);
    } catch (error) {
      throw asApiError(error);
    }
    await this.saveSecrets({
      ...secrets,
      credentials: { ...secrets.credentials, password },
    });
    this.context = null;
    if (config.paused === 'signed_out') this.config = { ...config, paused: null };
    this.failures = 0;
    this.publish();
    this.schedule(200);
    return this.status();
  }

  /**
   * Starts again after a pause. After a restore, this computer joins as a new one: where its
   * notes and the synced ones differ, the synced ones win and its page text is kept in history.
   */
  async resume(): Promise<SyncStatus> {
    this.requireDesktop();
    const config = this.config;
    if (!config) throw new ApiError(409, 'conflict', 'Sync isn’t set up.');
    if (config.paused === 'restored' || config.paused === 'vault_changed') {
      new SyncEngine({
        db: this.db,
        tables: this.tables,
        owner: this.o.owner(),
        deviceName: config.deviceName,
        hlc: new Hlc(config.deviceId, this.o.now),
        now: this.o.now,
      }).reset();
      this.write('run', NEW_RUN);
      this.config = {
        ...config,
        deviceId: uuidv7(this.o.now()),
        dataId: dataIdOf(this.db),
        joining: true,
        paused: null,
      };
    } else {
      this.config = { ...config, paused: null };
    }
    installCapture(this.db, this.tables.values());
    this.context = null;
    this.failures = 0;
    this.stopped = false;
    this.publish();
    this.schedule(200);
    return this.status();
  }

  /** Turns sync off on this computer. The folder, and the other computers, keep everything. */
  async disconnect(): Promise<SyncStatus> {
    this.requireDesktop();
    const config = this.config;
    await this.waitIdle();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const secrets = await this.loadSecrets();
    if (config && this.context) {
      await this.context.store
        .remove(`devices/${deviceFileName(config.deviceId)}`)
        .catch(() => undefined);
    }
    if (
      secrets.credentials?.kind === 'google' &&
      this.ownGoogleClient === null &&
      this.o.google?.client
    ) {
      await new GoogleTokens(this.o.google.client, secrets.credentials.refreshToken, this.endpoints)
        .revoke()
        .catch(() => undefined);
    }
    removeCapture(this.db);
    new SyncEngine({
      db: this.db,
      tables: this.tables,
      owner: this.o.owner(),
      deviceName: '',
      hlc: new Hlc(uuidv7(this.o.now()), this.o.now),
      now: this.o.now,
    }).reset();
    this.config = null;
    this.write('run', null);
    this.context = null;
    this.pending = null;
    await this.o.secrets
      .save({ credentials: null, vaultKey: null, googleClient: secrets.googleClient })
      .catch(() => undefined);
    this.o.log.info({}, 'sync turned off');
    this.publish();
    return this.status();
  }

  /** Runs now (or right after the run that is going on). */
  syncNow(): SyncStatus {
    this.requireDesktop();
    const config = this.config;
    if (!config || config.paused) return this.status();
    this.failures = 0;
    this.stopped = false;
    this.devicesReadAt = 0;
    if (this.running) this.again = true;
    else this.schedule(0);
    return this.status();
  }

  // Runs

  private async contextFor(config: SyncConfig): Promise<Context> {
    if (this.context && this.context.config.deviceId === config.deviceId) {
      this.context.config = config;
      return this.context;
    }
    const secrets = await this.loadSecrets();
    if (!secrets.vaultKey || !secrets.credentials) {
      throw new PauseError(
        'signed_out',
        'This computer no longer has the sync folder’s sign-in. Set sync up again.',
      );
    }
    const keys = deriveKeys(config.vaultId, Buffer.from(secrets.vaultKey, 'base64'));
    let store: RemoteStore;
    if (config.provider === 'folder') {
      store = await FolderStore.open(config.path ?? '');
    } else if (config.provider === 'google') {
      if (secrets.credentials.kind !== 'google')
        throw new PauseError('signed_out', 'Sign in to Google again.');
      const drive = new GoogleDriveStore(
        new GoogleTokens(this.googleClient(), secrets.credentials.refreshToken, this.endpoints),
        config.folder ?? 'Memora',
        config.rootId ?? null,
        this.endpoints,
      );
      const rootId = await drive.prepare();
      if (rootId !== config.rootId) this.config = { ...config, rootId };
      store = drive;
    } else {
      if (secrets.credentials.kind !== 'webdav') {
        throw new PauseError('signed_out', 'Enter the password again.');
      }
      store = new WebDavStore({
        url: config.url ?? '',
        username: secrets.credentials.username,
        password: secrets.credentials.password,
        allowHttp: this.o.allowHttp,
      });
    }
    const hlc = new Hlc(config.deviceId, this.o.now, this.run.hlc);
    const engine = new SyncEngine({
      db: this.db,
      tables: this.tables,
      owner: this.o.owner(),
      deviceName: config.deviceName,
      hlc,
      now: this.o.now,
    });
    this.context = { config, store, keys, engine, hlc };
    this.vaultCheckedAt = 0;
    this.snapshotsSeen.clear();
    return this.context;
  }

  /** One run: pull, push, and the occasional snapshot. Never throws. */
  async runOnce(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    const config = this.config;
    if (!config || config.paused) return;
    this.running = true;
    this.again = false;
    this.problems = [];
    this.publish();
    let delay = PULL_EVERY_MS;
    try {
      const ctx = await this.contextFor(config);
      if (this.o.now() - this.vaultCheckedAt >= VAULT_CHECK_EVERY_MS) {
        await this.checkVault(ctx);
        this.vaultCheckedAt = this.o.now();
      }
      const changes = await ctx.store.list('changes');
      if (ctx.config.joining) await this.joinSnapshot(ctx, changes);
      await this.pull(ctx, changes);
      if (ctx.config.joining) {
        ctx.engine.markUnsynced();
        this.config = { ...ctx.config, joining: false };
        ctx.config = this.config!;
        this.o.log.info({}, 'sync: joined the vault');
      }
      await this.push(ctx, changes);
      await this.maintain(ctx);
      const problem = this.problems[0];
      this.updateRun({
        lastSyncAt: this.o.now(),
        lastError: problem ? { message: problem, at: this.o.now() } : null,
        hlc: ctx.hlc.last(),
      });
      this.failures = 0;
      if (this.cleanupWanted && this.settled()) {
        this.cleanupWanted = false;
        this.onCleanup?.();
      }
    } catch (error) {
      if (error instanceof PauseError) {
        const current = this.config;
        if (current) this.config = { ...current, paused: error.reason };
        this.context = null;
        this.updateRun({ lastError: { message: error.message, at: this.o.now() } });
        this.o.log.warn({ reason: error.reason }, 'sync paused');
      } else {
        this.failures += 1;
        if (error instanceof RemoteError && error.kind === 'auth') {
          // The password or sign-in stopped working: ask, instead of trying again and again.
          const current = this.config;
          if (current) this.config = { ...current, paused: 'signed_out' };
          this.context = null;
        }
        // Problems with the folder or its files are explained; anything else is for the log.
        const message =
          error instanceof RemoteError || error instanceof VaultError || error instanceof ApiError
            ? error.message
            : 'Something went wrong while syncing. The details are in the log.';
        this.updateRun({ lastError: { message, at: this.o.now() } });
        this.o.log.warn(
          { err: error instanceof RemoteError || error instanceof VaultError ? message : error },
          'sync run failed',
        );
        delay = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(this.failures - 1, 5));
      }
    } finally {
      this.running = false;
      this.activity = null;
      this.lastRunEndedAt = this.o.now();
      this.publish();
      if (!this.config?.paused) this.schedule(this.again ? 0 : delay);
    }
  }

  /** A file that can't be used: logged, and shown once the run ends. Sync goes on without it. */
  private problem(message: string): void {
    if (!this.problems.includes(message)) this.problems.push(message);
    this.o.log.warn({ err: message }, 'sync: a file in the folder can’t be used');
  }

  /** The folder's vault must still be the one this computer joined, with the same key. */
  private async checkVault(ctx: Context): Promise<void> {
    const data = await ctx.store.read(VAULT_FILE, READ_LIMITS.small);
    if (!data) {
      throw new PauseError(
        'vault_changed',
        'The sync folder has no memora-vault.json any more: it was moved, emptied or deleted.',
      );
    }
    let header: VaultHeader;
    try {
      header = parseVaultHeader(data);
    } catch (error) {
      if (error instanceof VaultError && /newer Memora/.test(error.message)) {
        throw new PauseError('update_needed', error.message);
      }
      throw error;
    }
    if (header.vaultId !== ctx.config.vaultId) {
      throw new PauseError(
        'vault_changed',
        'The sync folder now holds another sync (a different vault).',
      );
    }
    checkKeys(header, ctx.keys);
  }

  /** Reads a file of the vault: one too large to be Memora's counts as damaged. */
  private async readFile(ctx: Context, path: string, maxBytes: number): Promise<Buffer | null> {
    try {
      return await ctx.store.read(path, maxBytes);
    } catch (error) {
      if (error instanceof RemoteError && error.kind === 'too_large') {
        throw new VaultError(`${path} is too large to be one Memora wrote.`);
      }
      throw error;
    }
  }

  /** Reads and checks one batch of another computer. */
  private async readBatch(ctx: Context, name: string): Promise<Batch | null> {
    const path = `changes/${name}`;
    const data = await this.readFile(ctx, path, READ_LIMITS.batch);
    if (!data) return null;
    const parsed = batchSchema.safeParse(openJson(ctx.keys, path, 'changes', data));
    const meta = parseChangesName(name);
    if (
      !parsed.success ||
      !meta ||
      parsed.data.device !== meta.device ||
      parsed.data.seq !== meta.seq
    ) {
      throw new VaultError(`${path} isn’t a valid batch of changes.`);
    }
    if (parsed.data.v > FORMAT_VERSION) {
      throw new PauseError(
        'update_needed',
        'Another computer uses a newer Memora. Update Memora here too.',
      );
    }
    return parsed.data;
  }

  /** Files the changes need, fetched and checked against their SHA-256. */
  private async fetchBlobs(ctx: Context, wanted: string[]): Promise<Map<string, Buffer>> {
    const blobs = new Map<string, Buffer>();
    let bytes = 0;
    for (const sha of wanted) {
      if (bytes > BLOB_BUDGET) break;
      const path = `files/${blobFileName(blobName(ctx.keys, sha))}`;
      let plain: Buffer;
      try {
        const data = await this.readFile(ctx, path, blobLimit(this.o.config.maxUploadBytes));
        if (!data) continue;
        plain = unseal(ctx.keys, path, 'blob', data);
        if (sha256(plain) !== sha) throw new VaultError(`${path} doesn’t hold the file it should.`);
      } catch (error) {
        // The rows that need it wait, as for a file that hasn't arrived; the rest goes on.
        if (!(error instanceof VaultError)) throw error;
        this.problem(error.message);
        continue;
      }
      blobs.set(sha, plain);
      bytes += plain.length;
    }
    return blobs;
  }

  /** Merges changes, fetching the files they need, and tells the open windows. */
  private async merge(ctx: Context, incoming: Incoming[]): Promise<void> {
    if (ctx.config.joining) {
      const inbox = incoming.find(
        (i) =>
          i.change.t === 'sections' &&
          i.change.op === 'put' &&
          Number(i.change.f?.is_inbox) === 1 &&
          typeof i.change.k[0] === 'string',
      );
      if (inbox) ctx.engine.adoptInbox(inbox.change.k[0] as string);
    }
    let items = incoming;
    for (let round = 0; round < 100; round += 1) {
      const wanted = ctx.engine.wantedBlobs(items);
      const blobs = wanted.length ? await this.fetchBlobs(ctx, wanted) : new Map<string, Buffer>();
      if (round > 0 && blobs.size === 0) break;
      const applied = ctx.engine.apply(items, { blobs, joining: ctx.config.joining });
      if (applied.failed) {
        this.o.log.warn(
          { table: applied.failed.table, err: applied.failed.error },
          'sync: a change couldn’t be applied; it waits and is tried again',
        );
      }
      this.announce(applied);
      items = [];
      // Another round only when the budget left files to fetch for rows that wait for them.
      if (blobs.size === 0 || blobs.size === wanted.length) break;
    }
  }

  /** Tells the windows what sync changed (ServerEvent). */
  private announce(applied: Applied): void {
    if (applied.changes === 0) return;
    let owner: string;
    try {
      owner = this.o.owner();
    } catch {
      return;
    }
    const parts: SyncedPart[] = [];
    if (applied.tree) {
      parts.push('tree');
      this.o.events.publish(owner, { type: 'tree.changed', origin: null });
    }
    if (applied.pages.size) {
      for (const meta of this.o.notes.pageRows(owner, [...applied.pages])) {
        this.o.events.publish(owner, {
          type: 'page.updated',
          page: meta,
          revision: meta.revision,
          origin: null,
        });
      }
    }
    if (applied.kanban) {
      parts.push('kanban');
      this.o.events.publish(owner, { type: 'projects.changed', origin: null });
    }
    if (applied.templates) parts.push('templates');
    if (applied.settings) parts.push('settings');
    if (parts.length) this.o.events.publish(owner, { type: 'synced', parts });
  }

  /**
   * Catches up from the newest complete snapshot that has what is missing here: everything,
   * when joining; batches removed before this computer read them; and the batches in `needs`
   * (each computer's batch that can't be used). Null `needs`: joining, unless batches were read
   * already. Answers whether a snapshot was read.
   */
  private async joinSnapshot(
    ctx: Context,
    changes: RemoteEntry[],
    needs: Map<string, number> | null = null,
  ): Promise<boolean> {
    // Without a snapshot that covers them, missing batches are waited for: they may be on
    // their way still.
    const run = this.run;
    if (!needs && Object.keys(run.cursors).length > 0) return false;
    // What the snapshot must have (or this computer read already): each computer's batches
    // before the first one still in the folder, and those in `needs`.
    const need = new Map<string, number>();
    for (const [device, seq] of this.firstSeqs(changes, ctx.config.deviceId)) {
      need.set(device, seq - 1);
    }
    for (const [device, seq] of needs ?? []) {
      need.set(device, Math.max(need.get(device) ?? 0, seq));
    }
    const listing = await ctx.store.list('snapshots');
    const snapshots = new Map<string, { at: number; device: string; parts: number[] }>();
    for (const entry of listing) {
      const meta = parseSnapshotName(entry.name);
      if (!meta || meta.device === ctx.config.deviceId) continue;
      const id = `${meta.at}.${meta.device}`;
      const s = snapshots.get(id) ?? { at: meta.at, device: meta.device, parts: [] };
      s.parts.push(meta.part);
      snapshots.set(id, s);
    }
    const candidates = [...snapshots.values()]
      .filter((s) => s.parts.includes(0))
      .sort((a, b) => b.at - a.at);
    candidates: for (const snap of candidates) {
      const parts = Math.max(...snap.parts) + 1;
      // Complete: every part there, and the highest one says it is the last.
      if (snap.parts.length !== parts) continue;
      const key = `${snap.at}.${snap.device}/${parts}`;
      try {
        let known = this.snapshotsSeen.get(key);
        if (known === undefined) {
          const final = await this.readSnapshotPart(ctx, snap.at, snap.device, parts - 1);
          if (!final) continue;
          known = { last: final.last, cursors: final.cursors };
          this.snapshotsSeen.set(key, known);
        }
        if (known === 'bad' || !known.last) continue;
        const { cursors: has } = known;
        const covers = [...need].every(
          ([device, seq]) => Math.max(has[device] ?? 0, run.cursors[device] ?? 0) >= seq,
        );
        if (!covers) continue;
        this.setActivity('Reading the synced notes');
        for (let part = 0; part < parts; part += 1) {
          const snapshot = await this.readSnapshotPart(ctx, snap.at, snap.device, part);
          if (!snapshot) {
            // Removed meanwhile (an older snapshot its computer no longer keeps).
            this.snapshotsSeen.set(key, 'bad');
            continue candidates;
          }
          await this.merge(
            ctx,
            snapshot.changes.map((change) => ({ device: snapshot.device, name: '', change })),
          );
        }
        const cursors = { ...this.run.cursors };
        for (const [device, seq] of Object.entries(has)) {
          if (device !== ctx.config.deviceId) cursors[device] = Math.max(cursors[device] ?? 0, seq);
        }
        this.updateRun({ cursors });
        return true;
      } catch (error) {
        // A damaged snapshot is passed over for an older one.
        if (!(error instanceof VaultError)) throw error;
        this.snapshotsSeen.set(key, 'bad');
        this.problem(error.message);
      }
    }
    return false;
  }

  private async readSnapshotPart(ctx: Context, at: number, device: string, part: number) {
    const name = snapshotName(at, device, part);
    const path = `snapshots/${name}`;
    const data = await this.readFile(ctx, path, READ_LIMITS.batch);
    if (!data) return null;
    const parsed = snapshotSchema.safeParse(openJson(ctx.keys, path, 'snapshot', data));
    if (
      !parsed.success ||
      parsed.data.device !== device ||
      parsed.data.at !== at ||
      parsed.data.part !== part
    ) {
      throw new VaultError(`${path} isn’t a valid snapshot.`);
    }
    if (parsed.data.v > FORMAT_VERSION) {
      throw new PauseError(
        'update_needed',
        'Another computer uses a newer Memora. Update Memora here too.',
      );
    }
    return parsed.data;
  }

  /** The first batch still in the folder, of each other computer. */
  private firstSeqs(changes: RemoteEntry[], own: string): Map<string, number> {
    const first = new Map<string, number>();
    for (const entry of changes) {
      const meta = parseChangesName(entry.name);
      if (!meta || meta.device === own) continue;
      first.set(meta.device, Math.min(first.get(meta.device) ?? Infinity, meta.seq));
    }
    return first;
  }

  /**
   * Brings in the batches other computers wrote since the last run, each computer's strictly in
   * order. A batch that hasn't arrived yet (a sync app delivers files in any order) holds back
   * that computer's later ones, not the other computers'; so does one that can't be used, until
   * a snapshot has what it had. Batches removed before they were read come from a snapshot.
   */
  private async pull(ctx: Context, changes: RemoteEntry[]): Promise<void> {
    const own = ctx.config.deviceId;
    const bySeq = new Map<string, number[]>();
    for (const entry of changes) {
      const meta = parseChangesName(entry.name);
      if (!meta || meta.device === own) continue;
      bySeq.set(meta.device, [...(bySeq.get(meta.device) ?? []), meta.seq]);
    }
    for (const seqs of bySeq.values()) seqs.sort((a, b) => a - b);
    let cursors = this.run.cursors;
    const removed = [...bySeq].some(([device, seqs]) => seqs[0]! > (cursors[device] ?? 0) + 1);
    if (removed) {
      await this.joinSnapshot(ctx, changes, new Map());
      cursors = this.run.cursors;
    }
    const queue: { device: string; seq: number }[] = [];
    for (const [device, seqs] of bySeq) {
      let next = (cursors[device] ?? 0) + 1;
      for (const seq of seqs) {
        if (seq < next) continue;
        if (seq !== next) break;
        queue.push({ device, seq });
        next += 1;
      }
    }
    queue.sort((a, b) => a.seq - b.seq || (a.device < b.device ? -1 : 1));
    if (queue.length) this.setActivity('Bringing in changes');
    const reached = { ...cursors };
    const held = new Set<string>();
    const damaged = new Map<string, { seq: number; message: string }>();
    for (let i = 0; i < queue.length; i += FILES_PER_ROUND) {
      const incoming: Incoming[] = [];
      for (const { device, seq } of queue.slice(i, i + FILES_PER_ROUND)) {
        if (held.has(device) || (reached[device] ?? 0) !== seq - 1) continue;
        let batch: Batch | null = null;
        try {
          batch = await this.readBatch(ctx, changesName(device, seq));
        } catch (error) {
          if (!(error instanceof VaultError)) throw error;
          damaged.set(device, { seq, message: error.message });
        }
        if (!batch) {
          held.add(device);
          continue;
        }
        for (const change of batch.changes) incoming.push({ device, name: batch.name, change });
        reached[device] = seq;
      }
      await this.merge(ctx, incoming);
      this.updateRun({ cursors: { ...reached }, hlc: ctx.hlc.last() });
    }
    if (damaged.size) {
      // Another computer's snapshot may have what the batch had; if so, read on from there.
      const needs = new Map([...damaged].map(([device, { seq }]) => [device, seq]));
      if (await this.joinSnapshot(ctx, changes, needs)) this.again = true;
      else {
        for (const { message } of damaged.values()) {
          this.problem(`${message} That computer’s changes wait until a snapshot has them.`);
        }
      }
    }
    this.lastPullAt = this.o.now();
  }

  /** Sends what changed here, batch by batch, files first. */
  private async push(ctx: Context, changes?: RemoteEntry[]): Promise<void> {
    if (ctx.engine.waiting() === 0) return;
    this.setActivity('Sending changes');
    // A batch written by a run that was cut short keeps its number.
    const ownSeqs = new Set(
      (changes ?? (await ctx.store.list('changes')))
        .map((e) => parseChangesName(e.name))
        .filter((m) => m?.device === ctx.config.deviceId)
        .map((m) => m!.seq),
    );
    let stored: Set<string> | null = null;
    for (let i = 0; i < 10_000; i += 1) {
      const out = ctx.engine.collect(BATCH_LIMIT, PART_BYTES);
      if (out.changes.length === 0) break;
      for (const sha of out.blobs) {
        stored ??= new Set((await ctx.store.list('files')).map((e) => e.name));
        const name = blobFileName(blobName(ctx.keys, sha));
        if (stored.has(name)) continue;
        const data = ctx.engine.blobData(sha);
        if (!data) continue;
        await ctx.store.write(`files/${name}`, seal(ctx.keys, `files/${name}`, 'blob', data));
        stored.add(name);
      }
      let seq = this.run.seq + 1;
      while (ownSeqs.has(seq)) seq += 1;
      // Only ever a new file: when the number is taken after all, the next one.
      for (let tries = 0; ; tries += 1) {
        if (tries === 100) {
          throw new RemoteError('Memora couldn’t write a new file in the sync folder.', 'other');
        }
        const name = changesName(ctx.config.deviceId, seq);
        const batch: Batch = {
          v: FORMAT_VERSION,
          device: ctx.config.deviceId,
          name: ctx.config.deviceName,
          seq,
          at: this.o.now(),
          changes: out.changes,
        };
        const path = `changes/${name}`;
        if (await ctx.store.create(path, sealJson(ctx.keys, path, 'changes', batch))) break;
        ownSeqs.add(seq);
        seq += 1;
      }
      ctx.engine.sent(out);
      const run = this.run;
      const written = [...run.written];
      const last = written.at(-1);
      if (!last || this.o.now() - last.at > 6 * 3_600_000) written.push({ seq, at: this.o.now() });
      this.updateRun({
        seq,
        hlc: ctx.hlc.last(),
        sentSinceSnapshot: run.sentSinceSnapshot + out.changes.length,
        written: written.slice(-400),
      });
      ownSeqs.add(seq);
      if (!out.more) break;
    }
  }

  /** This computer's record, a snapshot now and then, and removing what nobody needs. */
  private async maintain(ctx: Context): Promise<void> {
    const now = this.o.now();
    let run = this.run;
    if (!run.deviceRecordAt || now - run.deviceRecordAt > DEVICE_RECORD_EVERY_MS) {
      const path = `devices/${deviceFileName(ctx.config.deviceId)}`;
      await ctx.store.write(
        path,
        sealJson(ctx.keys, path, 'device', {
          v: FORMAT_VERSION,
          id: ctx.config.deviceId,
          name: ctx.config.deviceName,
          version: this.o.version,
          lastSeenAt: now,
          seq: run.seq,
        }),
      );
      this.updateRun({ deviceRecordAt: now });
      this.devicesReadAt = 0;
      run = this.run;
    }
    if (now - this.devicesReadAt >= DEVICE_LIST_EVERY_MS) {
      const devices: SyncDevice[] = [];
      for (const entry of await ctx.store.list('devices')) {
        const id = parseDeviceName(entry.name);
        if (!id) continue;
        const devicePath = `devices/${entry.name}`;
        try {
          const data = await ctx.store.read(devicePath, READ_LIMITS.small);
          if (!data) continue;
          const record = deviceSchema.safeParse(openJson(ctx.keys, devicePath, 'device', data));
          if (record.success && record.data.id === id) {
            devices.push({
              id,
              name: record.data.name,
              lastSeenAt: record.data.lastSeenAt,
              current: false,
            });
          }
        } catch {
          // A record that can't be read is left out of the list.
        }
      }
      this.updateRun({ devices });
      this.devicesReadAt = now;
      run = this.run;
    }
    const due =
      run.seq > 0 &&
      (run.snapshotAt === null ||
        run.sentSinceSnapshot >= SNAPSHOT_EVERY_CHANGES ||
        now - run.snapshotAt > SNAPSHOT_EVERY_MS);
    if (!due || ctx.engine.waiting() > 0) return;
    await this.writeSnapshot(ctx);
  }

  private async writeSnapshot(ctx: Context): Promise<void> {
    this.setActivity('Writing a snapshot');
    const run = this.run;
    const at = this.o.now();
    const cursors = { ...run.cursors, [ctx.config.deviceId]: run.seq };
    // Part by part, so a large database never sits in memory at once: the rows, then the
    // changes that wait here for a row they need (the snapshot says it has the batches they
    // came in). The last part says it is the last; a snapshot without one isn't complete.
    const partBytes = this.o.partBytes ?? PART_BYTES;
    let position: SnapshotPosition | null = null;
    let parked: Change[] | null = null;
    for (let part = 0; ; part += 1) {
      let changes: Change[];
      if (parked === null) {
        const page: { changes: Change[]; next: SnapshotPosition | null } = ctx.engine.snapshotPage(
          position,
          partBytes,
        );
        changes = page.changes;
        position = page.next;
        if (position === null) parked = ctx.engine.parkedChanges();
      } else {
        let bytes = 0;
        let count = 0;
        while (count < parked.length && (count === 0 || bytes < partBytes)) {
          bytes += JSON.stringify(parked[count]).length;
          count += 1;
        }
        changes = parked.splice(0, count);
      }
      const last = parked !== null && parked.length === 0;
      const name = snapshotName(at, ctx.config.deviceId, part);
      await ctx.store.write(
        `snapshots/${name}`,
        sealJson(ctx.keys, `snapshots/${name}`, 'snapshot', {
          v: FORMAT_VERSION,
          device: ctx.config.deviceId,
          at,
          part,
          last,
          cursors,
          changes,
        }),
      );
      if (last) break;
    }
    this.updateRun({ snapshotAt: at, sentSinceSnapshot: 0 });

    // This computer's older snapshots, and its batches the snapshot has, after a month.
    const listing = await ctx.store.list('snapshots');
    const own = new Map<number, string[]>();
    for (const entry of listing) {
      const meta = parseSnapshotName(entry.name);
      if (meta?.device !== ctx.config.deviceId) continue;
      own.set(meta.at, [...(own.get(meta.at) ?? []), entry.name]);
    }
    const old = [...own.keys()].sort((a, b) => b - a).slice(KEEP_SNAPSHOTS);
    for (const time of old)
      for (const name of own.get(time)!) await ctx.store.remove(`snapshots/${name}`);
    const cutoff = at - KEEP_BATCHES_MS;
    // Never the newest: it tells the other computers how far this one got.
    const removable = Math.min(
      run.seq - 1,
      run.written.filter((w) => w.at < cutoff).reduce((max, w) => Math.max(max, w.seq), 0),
    );
    if (removable > 0) {
      for (const entry of await ctx.store.list('changes')) {
        const meta = parseChangesName(entry.name);
        if (meta?.device === ctx.config.deviceId && meta.seq <= removable) {
          await ctx.store.remove(`changes/${entry.name}`);
        }
      }
    }
    // Stored files no row refers to any more, a month after they were written.
    if (ctx.engine.parkedCount() === 0) {
      const used = new Set(
        (this.db.prepare('SELECT sha256 FROM asset_blobs').all() as { sha256: string }[]).map((r) =>
          blobFileName(blobName(ctx.keys, r.sha256)),
        ),
      );
      for (const entry of await ctx.store.list('files')) {
        if (
          STORED_FILE.test(entry.name) &&
          !used.has(entry.name) &&
          entry.modifiedAt !== undefined &&
          entry.modifiedAt < cutoff
        ) {
          await ctx.store.remove(`files/${entry.name}`);
        }
      }
    }
  }
}

/** Sync stops and waits for the person: the reason shows in the settings. */
class PauseError extends Error {
  override name = 'PauseError';
  constructor(
    readonly reason: SyncPauseReason,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A folder without memora-vault.json gets a new vault only when the vault's folders are empty:
 * never on top of files that aren't Memora's, or of a vault whose memora-vault.json is gone (or
 * not delivered yet by a sync app).
 */
async function assertNoVaultFiles(store: RemoteStore): Promise<void> {
  for (const dir of VAULT_DIRS) {
    if ((await store.list(dir)).length > 0) {
      throw new ApiError(
        409,
        'conflict',
        `This folder has no memora-vault.json, but its “${dir}” folder has files in it. Choose an empty folder, or a new one.`,
      );
    }
  }
}

/** Writes, reads back and removes a small file: Memora may really write in the folder. */
async function probe(store: RemoteStore): Promise<void> {
  const name = `memora-probe-${randomBytes(6).toString('hex')}.tmp`;
  const data = randomBytes(32);
  await store.write(name, data);
  const back = await store.read(name, READ_LIMITS.small);
  await store.remove(name);
  if (!back || !back.equals(data)) {
    throw new RemoteError('Memora wrote a file in the folder but couldn’t read it back.', 'other');
  }
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof RemoteError) {
    return new ApiError(error.kind === 'network' ? 502 : 400, 'invalid_request', error.message);
  }
  if (error instanceof VaultError) return new ApiError(400, 'invalid_request', error.message);
  throw error;
}
