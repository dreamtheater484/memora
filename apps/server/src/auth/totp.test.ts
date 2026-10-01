import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  newTotpSecret,
  openSecret,
  otpauthUri,
  sealSecret,
  stepAt,
  totpAt,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors (their last six digits)', () => {
    const vectors: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpAt(RFC_SECRET, seconds * 1000)).toBe(code.slice(-6));
      expect(hotp(Buffer.from('12345678901234567890'), stepAt(seconds * 1000), 8)).toBe(code);
    }
  });

  it('accepts a code one step either side, once', () => {
    const secret = newTotpSecret();
    const now = Date.UTC(2026, 8, 30, 12, 0, 10);
    const step = stepAt(now);
    const code = totpAt(secret, now);
    expect(verifyTotp(secret, code, now, null)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, now + 30_000), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, totpAt(secret, now - 90_000), now, null)).toBeNull();
    // Used once: the same code, or an older one, no longer works.
    expect(verifyTotp(secret, code, now, step)).toBeNull();
    expect(verifyTotp(secret, totpAt(secret, now - 30_000), now, step)).toBeNull();
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now, null)).toBe(step);
    expect(verifyTotp(secret, 'abcdef', now, null)).toBeNull();
    expect(verifyTotp(secret, '12345', now, null)).toBeNull();
  });

  it('round-trips base32', () => {
    for (const size of [1, 5, 10, 20, 33]) {
      const bytes = randomBytes(size);
      expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    }
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('mzxw 6ytb oi')).toEqual(Buffer.from('foobar'));
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('writes the address authenticator apps read', () => {
    expect(otpauthUri('JBSWY3DPEHPK3PXP', 'alex', 'Memora')).toBe(
      'otpauth://totp/Memora%3Aalex?secret=JBSWY3DPEHPK3PXP&issuer=Memora&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('secrets at rest', () => {
  it('open only with the key they were sealed with', () => {
    const key = randomBytes(32);
    const sealed = sealSecret(key, 'JBSWY3DPEHPK3PXP');
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(key, sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(openSecret(randomBytes(32), sealed)).toBeNull();
    // Damaged: the data's first character always encodes six bits of its first byte (the last
    // ones may only pad, and changing them can leave the bytes as they were).
    const at = sealed.lastIndexOf(':') + 1;
    const damaged = `${sealed.slice(0, at)}${sealed[at] === 'A' ? 'B' : 'A'}${sealed.slice(at + 1)}`;
    expect(openSecret(key, damaged)).toBeNull();
    expect(openSecret(key, 'plain')).toBeNull();
  });
});
