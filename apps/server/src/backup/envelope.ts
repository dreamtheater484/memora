import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

/*
 * The encryption envelope (§8.4, §9.14), shared by encrypted backups and, later, `.memora`
 * exports: the magic bytes `MEMORAENC1`, the scrypt parameters, a salt and a nonce, then the
 * content encrypted with AES-256-GCM, then the authentication tag. The header is authenticated
 * too, so its parameters can't be changed unnoticed. Files are streamed through, so a large
 * backup needs no more memory than a small one (plus scrypt's, once).
 */

const MAGIC = Buffer.from('MEMORAENC1', 'latin1');
const SALT = 16;
const NONCE = 12;
const TAG = 16;
const HEADER = MAGIC.length + 3 + SALT + NONCE;

/** scrypt with N = 2^16, r = 8, p = 1: 64 MiB for a moment, about a tenth of a second. */
const DEFAULT_KDF = { logN: 16, r: 8, p: 1 };

export class EnvelopeError extends Error {
  override name = 'EnvelopeError';
}

function deriveKey(
  password: string,
  salt: Buffer,
  { logN, r, p }: typeof DEFAULT_KDF,
): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 32, { N, r, p, maxmem: 256 * r * N }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

/** Whether a file starts with the envelope's magic bytes. */
export async function isEncrypted(file: string): Promise<boolean> {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    const { bytesRead } = await handle.read(head, 0, MAGIC.length, 0);
    return bytesRead === MAGIC.length && head.equals(MAGIC);
  } finally {
    await handle.close();
  }
}

/** Encrypts `source` into `target` with the password. */
export async function encryptFile(
  source: string,
  target: string,
  password: string,
  kdf = DEFAULT_KDF,
): Promise<void> {
  const salt = randomBytes(SALT);
  const nonce = randomBytes(NONCE);
  const header = Buffer.concat([MAGIC, Buffer.from([kdf.logN, kdf.r, kdf.p]), salt, nonce]);
  const key = await deriveKey(password, salt, kdf);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const out = createWriteStream(target, { flags: 'wx' });
  try {
    out.write(header);
    await pipeline(createReadStream(source), cipher, out, { end: false });
    await new Promise<void>((resolve, reject) =>
      out.end(cipher.getAuthTag(), () => resolve()).once('error', reject),
    );
  } catch (error) {
    out.destroy();
    await rm(target, { force: true });
    throw error;
  }
}

/** Decrypts `source` into `target`; a wrong password or a damaged file leaves no target. */
export async function decryptFile(source: string, target: string, password: string): Promise<void> {
  const { size } = await stat(source);
  if (size < HEADER + TAG) throw new EnvelopeError('This isn’t an encrypted Memora file.');
  const handle = await open(source, 'r');
  const header = Buffer.alloc(HEADER);
  const tag = Buffer.alloc(TAG);
  try {
    await handle.read(header, 0, HEADER, 0);
    await handle.read(tag, 0, TAG, size - TAG);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new EnvelopeError('This isn’t an encrypted Memora file.');
  }
  const [logN = 0, r = 0, p = 0] = header.subarray(MAGIC.length, MAGIC.length + 3);
  if (logN < 10 || logN > 22 || r < 1 || r > 32 || p < 1 || p > 16) {
    throw new EnvelopeError('This file’s key settings aren’t supported.');
  }
  const salt = header.subarray(MAGIC.length + 3, MAGIC.length + 3 + SALT);
  const nonce = header.subarray(MAGIC.length + 3 + SALT, HEADER);
  const key = await deriveKey(password, salt, { logN, r, p });
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(source, { start: HEADER, end: size - TAG - 1 }),
      decipher,
      createWriteStream(target, { flags: 'wx' }),
    );
  } catch (error) {
    await rm(target, { force: true });
    if (error instanceof Error && /authenticate/i.test(error.message)) {
      throw new EnvelopeError('Wrong password, or the file is damaged.');
    }
    throw error;
  }
}
