import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/*
 * The instance's secret key (§11, Phase 12): 32 random bytes in a file of their own in the
 * data folder, made on first start and readable only by Memora's user. It seals what must not
 * be readable from the database (or its backups) alone: two-step verification secrets.
 */

export class SecretKeyError extends Error {
  override name = 'SecretKeyError';
}

/** Reads the key, making it first when the file doesn't exist. */
export function loadSecretKey(file: string): Buffer {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const key = randomBytes(32);
    mkdirSync(dirname(file), { recursive: true });
    // `wx`: never overwrite a key another process has just written.
    writeFileSync(file, `${key.toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    return key;
  }
  const hex = text.trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new SecretKeyError(
      `${file} is not a Memora secret key (64 hexadecimal characters). Restore it from a copy, or remove it to make a new one (two-step verification then has to be set up again).`,
    );
  }
  return Buffer.from(hex, 'hex');
}
