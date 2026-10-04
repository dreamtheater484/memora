import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from './auth';

/*
 * Syncing the desktop app through a folder in the cloud (ADR 0006, Phase 15). Each computer
 * keeps its own database; the folder holds end-to-end encrypted change files that every
 * computer writes and reads. Memora reaches that one folder: on Google Drive only the files it
 * created (the `drive.file` scope), on WebDAV one base address it never leaves.
 */

export const SYNC_PROVIDERS = ['google', 'kdrive', 'webdav', 'folder'] as const;
export type SyncProvider = (typeof SYNC_PROVIDERS)[number];

/** Shortest sync passphrase: the same rule as account passwords. */
export const SYNC_PASSPHRASE_MIN = 12;

/** A folder name in the cloud: one or more simple names separated by `/`. */
const folderPath = z
  .string()
  .trim()
  .min(1, 'Name a folder.')
  .max(200)
  .refine(
    (value) =>
      value
        .split('/')
        .every(
          (part) =>
            /^[^\\/:*?"<>|]{1,100}$/.test(part) &&
            ![...part].some((c) => c.charCodeAt(0) < 32) &&
            !/^\.+$/.test(part),
        ),
    'Use folder names without \\ : * ? " < > | and without “.” or “..” on their own.',
  );

const secret = z.string().min(1, 'Enter it.').max(1024);

export const connectSyncSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('google'),
    /** The folder Memora creates in My Drive (or finds, when it made it before). */
    folder: folderPath.default('Memora'),
  }),
  z.object({
    provider: z.literal('kdrive'),
    /** The number in the kDrive's web address: `https://ksuite.infomaniak.com/kdrive/app/drive/<id>`. */
    driveId: z
      .string()
      .trim()
      .regex(/^\d{1,12}$/, 'The kDrive ID is a number, such as 123456.'),
    username: z.string().trim().min(3, 'Enter the e-mail address you sign in with.').max(254),
    password: secret,
    folder: folderPath.default('Memora'),
  }),
  z.object({
    provider: z.literal('webdav'),
    url: z
      .string()
      .trim()
      .max(2000)
      .pipe(
        z.url({
          protocol: /^https$/,
          message: 'Enter the folder’s WebDAV address, starting with https://.',
        }),
      )
      // No name or password in the address, and nothing after “?” or “#”.
      .refine((value) => !/^https:\/\/[^/]*@/i.test(value) && !/[?#]/.test(value), {
        message: 'Enter the address without a name, password, “?” or “#”.',
      }),
    username: z.string().trim().min(1, 'Enter the user name.').max(254),
    password: secret,
  }),
  z.object({
    provider: z.literal('folder'),
    /** A folder on this computer, such as one the Google Drive or kDrive app keeps in sync. */
    path: z.string().trim().min(1, 'Choose a folder.').max(1000),
  }),
]);
export type ConnectSyncRequest = z.input<typeof connectSyncSchema>;

export const enableSyncSchema = z.object({
  passphrase: z.string().min(1, 'Enter the passphrase.').max(PASSWORD_MAX_LENGTH),
});
export type EnableSyncRequest = z.input<typeof enableSyncSchema>;

/** Your own Google Cloud client, instead of the one in this build (Settings → Sync → Advanced). */
export const googleClientSchema = z.object({
  clientId: z
    .string()
    .trim()
    .regex(/^[\w.-]+\.apps\.googleusercontent\.com$/, 'This isn’t a Google OAuth client ID.'),
  clientSecret: z.string().trim().max(200).optional(),
});
export type GoogleClient = z.input<typeof googleClientSchema>;

/** `POST /sync/connect`: Memora reached the folder; is there a vault in it already? */
export interface SyncConnected {
  /** `new`: the folder has no Memora sync yet; `existing`: enter its passphrase. */
  vault: 'new' | 'existing';
  location: string;
}

export interface SyncDevice {
  id: string;
  name: string;
  lastSeenAt: number | null;
  /** This computer. */
  current: boolean;
}

export type SyncState =
  /** Not set up. */
  | 'off'
  /** A folder is chosen; the passphrase is next. */
  | 'connecting'
  | 'on'
  /** Set up, but stopped until someone looks (see `paused`). */
  | 'paused';

export type SyncPauseReason =
  /** A backup was restored: the restored database's sync state is out of date. */
  | 'restored'
  /** The folder's vault isn't the one this computer joined. */
  | 'vault_changed'
  /** The cloud no longer accepts the saved sign-in or password. */
  | 'signed_out'
  /** This computer can't keep the sign-in safely any more (its keyring is gone). */
  | 'no_secure_storage'
  /** The vault was made by a newer Memora. */
  | 'update_needed';

export interface SyncStatus {
  /** Only the desktop app syncs through a folder. */
  available: boolean;
  /** The computer can keep secrets safely (Windows, macOS, Linux with a keyring). */
  secureStorage: boolean;
  /** This build can sign in to Google Drive (or a client of your own is set). */
  google: { available: boolean; ownClient: boolean };
  state: SyncState;
  provider: SyncProvider | null;
  /** Where the folder is, for people: “Google Drive › Memora”, an address, a path. */
  location: string | null;
  /** While connecting: whether the folder has a vault, and for Google, the sign-in. */
  pending: {
    provider: SyncProvider;
    location: string | null;
    vault: 'new' | 'existing' | null;
    /** Google: waiting for the browser, or signed in. */
    signIn: 'waiting' | 'done' | 'failed' | null;
    signInError: string | null;
  } | null;
  paused: SyncPauseReason | null;
  /** Syncing right now. */
  running: boolean;
  /** What the current run does, for a progress line. */
  activity: string | null;
  lastSyncAt: number | null;
  lastError: { message: string; at: number } | null;
  /** Changes made here that haven't reached the folder yet. */
  waiting: number;
  device: { id: string; name: string } | null;
  devices: SyncDevice[];
}

/** What sync brought in, so open views reload (ServerEvent `synced`). */
export const SYNCED_PARTS = ['tree', 'kanban', 'templates', 'settings'] as const;
export type SyncedPart = (typeof SYNCED_PARTS)[number];
