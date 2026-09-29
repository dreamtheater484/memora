import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** A 256-bit random session token (§11), URL-safe. */
export const newSessionToken = (): string => randomBytes(32).toString('base64url');

/** What the database stores instead of the token. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('base64url');

/**
 * The CSRF token for a session: derived from the session token, so it needs no storage and
 * changes whenever the session is rotated. It reveals nothing about the session token.
 */
export const csrfTokenFor = (sessionToken: string): string =>
  createHmac('sha256', sessionToken).update('memora-csrf-v1').digest('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Crockford's base32: no I, L, O or U, so codes survive being read aloud or retyped.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A human-typable random code, grouped in fours: `7KQ2-MX9D-…`. 5 bits per character. */
export function newReadableCode(groups: number): string {
  const parts: string[] = [];
  for (let g = 0; g < groups; g += 1) {
    let part = '';
    for (let i = 0; i < 4; i += 1) part += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    parts.push(part);
  }
  return parts.join('-');
}

/** Accepts lowercase, spaces and dashes, and the letters people confuse with digits. */
export const normalizeReadableCode = (input: string): string =>
  input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

/**
 * A one-time password for admin-created users and resets: 80 random bits, lowercase, grouped.
 * The user must replace it at their next login.
 */
export const newTemporaryPassword = (): string => newReadableCode(4).toLowerCase();
