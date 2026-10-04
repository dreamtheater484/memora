import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { uuidv7 } from '@memora/shared';
import { z } from 'zod';

/*
 * The vault's encryption (ADR 0006). A passphrase gives the vault key through scrypt; HKDF
 * derives one key for the files' contents and one for the names of stored files. Every file is
 * encrypted with AES-256-GCM, and its header and its path in the folder are authenticated too,
 * so a file that was changed, renamed or put there by someone else fails before it is read.
 *
 *   MEMORASYNC1 · kind (1 byte) · nonce (12 bytes) · ciphertext · tag (16 bytes)
 */

export const VAULT_FILE = 'memora-vault.json';
export const VAULT_FORMAT = 'memora-sync';
export const VAULT_VERSION = 1;

const MAGIC = Buffer.from('MEMORASYNC1', 'latin1');
const NONCE = 12;
const TAG = 16;
const HEADER = MAGIC.length + 1 + NONCE;

/** What a file holds: part of its authenticated header. */
export const FILE_KINDS = {
  check: 0,
  changes: 1,
  blob: 2,
  snapshot: 3,
  device: 4,
  probe: 5,
} as const;
export type FileKind = keyof typeof FILE_KINDS;

/** scrypt with N = 2^16, r = 8, p = 1, as for encrypted backups (D34). */
const KDF = { logN: 16, r: 8, p: 1 };
/** scrypt's settings for a new vault. */
export type VaultKdf = typeof KDF;

/** Largest file content after decompression: change batches and snapshot parts stay far below. */
export const MAX_PLAIN_BYTES = 256 * 1024 * 1024;

export class VaultError extends Error {
  override name = 'VaultError';
}

export const vaultHeaderSchema = z.object({
  format: z.literal(VAULT_FORMAT),
  version: z.number().int().min(1),
  vaultId: z.string().regex(/^[0-9a-f-]{36}$/),
  createdAt: z.number().int(),
  kdf: z.object({
    name: z.literal('scrypt'),
    // Capped: a planted vault file mustn't make opening it take minutes or gigabytes.
    logN: z.number().int().min(14).max(17),
    r: z.number().int().min(1).max(8),
    p: z.number().int().min(1).max(4),
    salt: z.string().regex(/^[A-Za-z0-9+/]{22,}={0,2}$/),
  }),
  check: z.string().max(200),
});
export type VaultHeader = z.infer<typeof vaultHeaderSchema>;

export interface VaultKeys {
  vaultId: string;
  /** The key the passphrase gives: kept (sealed by the system) so the passphrase isn't. */
  master: Buffer;
  content: Buffer;
  names: Buffer;
}

function kdf(passphrase: string, salt: Buffer, { logN, r, p }: VaultKdf): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) =>
    scrypt(passphrase.normalize('NFC'), salt, 32, { N, r, p, maxmem: 256 * r * N }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** The content and name keys, from the vault key. */
export function deriveKeys(vaultId: string, master: Buffer): VaultKeys {
  const salt = Buffer.from(vaultId, 'latin1');
  const derive = (info: string) => Buffer.from(hkdfSync('sha256', master, salt, info, 32));
  return {
    vaultId,
    master,
    content: derive('memora-sync content v1'),
    names: derive('memora-sync names v1'),
  };
}

const checkText = (vaultId: string) => Buffer.from(`memora-vault:${vaultId}`, 'utf8');

/** A new vault: its header (written in the folder) and its keys. */
export async function createVault(
  passphrase: string,
  now: number,
  settings: VaultKdf = KDF,
): Promise<{ header: VaultHeader; keys: VaultKeys }> {
  const vaultId = uuidv7(now);
  const salt = randomBytes(16);
  const keys = deriveKeys(vaultId, await kdf(passphrase, salt, settings));
  const header: VaultHeader = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    vaultId,
    createdAt: now,
    kdf: { name: 'scrypt', ...settings, salt: salt.toString('base64') },
    check: seal(keys, VAULT_FILE, 'check', checkText(vaultId)).toString('base64'),
  };
  return { header, keys };
}

/** Reads a vault's header from the folder's vault file; throws VaultError when it isn't one. */
export function parseVaultHeader(data: Buffer): VaultHeader {
  let json: unknown;
  try {
    json = JSON.parse(data.toString('utf8'));
  } catch {
    throw new VaultError('The folder’s memora-vault.json is damaged.');
  }
  const parsed = vaultHeaderSchema.safeParse(json);
  if (!parsed.success) throw new VaultError('The folder’s memora-vault.json is damaged.');
  if (parsed.data.version > VAULT_VERSION) {
    throw new VaultError('This folder was set up by a newer Memora. Update Memora first.');
  }
  return parsed.data;
}

/** The keys of a vault, from its passphrase; throws VaultError when the passphrase is wrong. */
export async function unlockVault(header: VaultHeader, passphrase: string): Promise<VaultKeys> {
  const { logN, r, p, salt } = header.kdf;
  const master = await kdf(passphrase, Buffer.from(salt, 'base64'), { logN, r, p });
  const keys = deriveKeys(header.vaultId, master);
  checkKeys(header, keys);
  return keys;
}

/** Throws VaultError unless these are the vault's keys. */
export function checkKeys(header: VaultHeader, keys: VaultKeys): void {
  let plain: Buffer;
  try {
    plain = unseal(keys, VAULT_FILE, 'check', Buffer.from(header.check, 'base64'));
  } catch {
    throw new VaultError('That isn’t the passphrase of this folder’s sync.');
  }
  const expected = checkText(header.vaultId);
  if (plain.length !== expected.length || !timingSafeEqual(plain, expected)) {
    throw new VaultError('That isn’t the passphrase of this folder’s sync.');
  }
}

/** Encrypts a file's bytes for its place in the folder. */
export function seal(keys: VaultKeys, path: string, kind: FileKind, plain: Buffer): Buffer {
  const header = Buffer.concat([MAGIC, Buffer.from([FILE_KINDS[kind]]), randomBytes(NONCE)]);
  const cipher = createCipheriv('aes-256-gcm', keys.content, header.subarray(MAGIC.length + 1));
  cipher.setAAD(Buffer.concat([header, Buffer.from(path, 'utf8')]));
  return Buffer.concat([header, cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

/** Decrypts a file read from the folder; throws VaultError when it was changed or moved. */
export function unseal(keys: VaultKeys, path: string, kind: FileKind, data: Buffer): Buffer {
  if (data.length < HEADER + TAG || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new VaultError(`${path} isn’t a Memora sync file.`);
  }
  if (data[MAGIC.length] !== FILE_KINDS[kind]) {
    throw new VaultError(`${path} isn’t the kind of file its name says.`);
  }
  const header = data.subarray(0, HEADER);
  const decipher = createDecipheriv('aes-256-gcm', keys.content, header.subarray(MAGIC.length + 1));
  decipher.setAAD(Buffer.concat([header, Buffer.from(path, 'utf8')]));
  decipher.setAuthTag(data.subarray(data.length - TAG));
  try {
    return Buffer.concat([
      decipher.update(data.subarray(HEADER, data.length - TAG)),
      decipher.final(),
    ]);
  } catch {
    throw new VaultError(`${path} was changed by something other than Memora, or is damaged.`);
  }
}

/** Compresses, then encrypts, a JSON value. */
export function sealJson(keys: VaultKeys, path: string, kind: FileKind, value: unknown): Buffer {
  return seal(keys, path, kind, gzipSync(Buffer.from(JSON.stringify(value), 'utf8')));
}

/** Decrypts, then decompresses, a JSON value (validated by the caller). */
export function openJson(keys: VaultKeys, path: string, kind: FileKind, data: Buffer): unknown {
  const zipped = unseal(keys, path, kind, data);
  let plain: Buffer;
  try {
    plain = gunzipSync(zipped, { maxOutputLength: MAX_PLAIN_BYTES });
  } catch {
    throw new VaultError(`${path} is damaged or too large.`);
  }
  try {
    return JSON.parse(plain.toString('utf8')) as unknown;
  } catch {
    throw new VaultError(`${path} is damaged.`);
  }
}

/** A stored file's name in the folder: says nothing about its content to whoever lists it. */
export function blobName(keys: VaultKeys, sha256: string): string {
  return createHmac('sha256', keys.names).update(sha256, 'latin1').digest('hex');
}
