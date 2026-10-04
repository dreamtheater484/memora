/*
 * Where the vault's files are kept (ADR 0006): a folder on Google Drive, on a WebDAV server or
 * on this computer, all behind the same four operations. Paths are always one of a few fixed
 * shapes built by Memora itself, checked here before any store sees them, so nothing (not even
 * a bug elsewhere) can name a file outside the folder.
 */

export interface RemoteEntry {
  name: string;
  size?: number;
  /** Epoch milliseconds, when the store says. */
  modifiedAt?: number;
}

export interface RemoteStore {
  /**
   * Reads a whole file; null when there's no such file. A file larger than `maxBytes` is
   * refused before it is read (what is in the folder isn't trusted until it is decrypted).
   */
  read(path: string, maxBytes: number): Promise<Buffer | null>;
  /** Writes a whole file, replacing it when it exists. */
  write(path: string, data: Buffer): Promise<void>;
  /**
   * Writes a file that must be new: answers false, and leaves the file alone, when one is
   * there already. Batches of changes are written this way, so a number is never used twice.
   */
  create(path: string, data: Buffer): Promise<boolean>;
  /** The files directly in a folder of the vault (none when the folder isn't there yet). */
  list(dir: VaultDir): Promise<RemoteEntry[]>;
  /** Removes a file; nothing happens when it isn't there. */
  remove(path: string): Promise<void>;
}

/** The folders in a vault. */
export const VAULT_DIRS = ['changes', 'files', 'snapshots', 'devices'] as const;
export type VaultDir = (typeof VAULT_DIRS)[number];

/** A file name Memora makes: letters, digits, dots, dashes and underscores, nothing else. */
export const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

export type RemoteErrorKind =
  /** The sign-in or password isn't accepted (any more). */
  | 'auth'
  /** The server says Memora may not do this, or sent it elsewhere. */
  | 'denied'
  /** No answer: offline, a timeout, the server down. */
  | 'network'
  /** A file larger than Memora ever writes: not read. */
  | 'too_large'
  | 'other';

export class RemoteError extends Error {
  override name = 'RemoteError';

  constructor(
    message: string,
    readonly kind: RemoteErrorKind,
    readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * The parts of a vault path: `memora-vault.json` and other names at the top, or a name in one
 * of the vault's folders. Throws for anything else.
 */
export function pathParts(path: string): [string] | [VaultDir, string] {
  const parts = path.split('/');
  if (parts.length === 1 && NAME.test(parts[0]!)) return [parts[0]!];
  if (
    parts.length === 2 &&
    (VAULT_DIRS as readonly string[]).includes(parts[0]!) &&
    NAME.test(parts[1]!)
  ) {
    return [parts[0] as VaultDir, parts[1]!];
  }
  throw new Error(`Not a vault path: ${JSON.stringify(path)}`);
}

/** Reads an answer's body, refusing more than `max` bytes. */
export async function readLimited(response: Response, max: number): Promise<Buffer> {
  const length = Number(response.headers.get('content-length') ?? NaN);
  if (Number.isFinite(length) && length > max) {
    await response.body?.cancel().catch(() => undefined);
    throw new RemoteError('A file in the sync folder is too large.', 'too_large');
  }
  if (!response.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += (chunk as Uint8Array).length;
    if (total > max) throw new RemoteError('A file in the sync folder is too large.', 'too_large');
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/** The largest file of each kind Memora reads from the folder: well above what it writes. */
export const READ_LIMITS = {
  /** memora-vault.json, a computer's record, the test file. */
  small: 64 * 1024,
  /** A batch of changes or a snapshot part: about 8 MB of JSON, compressed. */
  batch: 64 * 1024 * 1024,
} as const;

/** A stored file: an image or attachment, up to the upload limit (and its encryption). */
export const blobLimit = (maxUploadBytes: number) => maxUploadBytes + 64 * 1024;

/** A failed fetch (no answer at all) as a RemoteError. */
export function networkError(error: unknown, what: string): RemoteError {
  if (error instanceof RemoteError) return error;
  const timeout = error instanceof Error && error.name === 'TimeoutError';
  return new RemoteError(
    timeout ? `${what} didn’t answer in time.` : `Memora couldn’t reach ${what}.`,
    'network',
  );
}
