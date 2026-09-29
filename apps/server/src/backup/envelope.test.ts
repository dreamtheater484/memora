import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EnvelopeError, decryptFile, encryptFile, isEncrypted } from './envelope';

const dir = mkdtempSync(join(tmpdir(), 'memora-envelope-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
// Cheap key settings keep the test fast; the defaults are the same code with a larger N.
const kdf = { logN: 10, r: 8, p: 1 };

describe('the encryption envelope', () => {
  it('encrypts and decrypts a file, and knows encrypted files', async () => {
    const plain = join(dir, 'plain.db');
    const data = randomBytes(300_000);
    writeFileSync(plain, data);
    await encryptFile(plain, join(dir, 'box.enc'), 'correct horse', kdf);
    expect(await isEncrypted(join(dir, 'box.enc'))).toBe(true);
    expect(await isEncrypted(plain)).toBe(false);
    expect(readFileSync(join(dir, 'box.enc')).includes(data.subarray(0, 64))).toBe(false);
    await decryptFile(join(dir, 'box.enc'), join(dir, 'back.db'), 'correct horse');
    expect(readFileSync(join(dir, 'back.db')).equals(data)).toBe(true);
  });

  it('refuses a wrong password or a changed file, leaving nothing behind', async () => {
    const plain = join(dir, 'p2.db');
    writeFileSync(plain, 'hello');
    await encryptFile(plain, join(dir, 'b2.enc'), 'right', kdf);
    await expect(decryptFile(join(dir, 'b2.enc'), join(dir, 'o2.db'), 'wrong')).rejects.toThrow(
      EnvelopeError,
    );
    expect(existsSync(join(dir, 'o2.db'))).toBe(false);
    const box = readFileSync(join(dir, 'b2.enc'));
    // A changed header (the key settings) is noticed too.
    box[10] = kdf.logN + 1;
    writeFileSync(join(dir, 'b3.enc'), box);
    await expect(decryptFile(join(dir, 'b3.enc'), join(dir, 'o3.db'), 'right')).rejects.toThrow();
    expect(existsSync(join(dir, 'o3.db'))).toBe(false);
  });
});
