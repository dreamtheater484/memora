import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/*
 * Two-step verification (§11, Phase 12): time-based one-time passwords (RFC 6238, the codes
 * of authenticator apps: HMAC-SHA1, 30-second steps, six digits), and the encryption of the
 * shared secrets at rest. Written against node:crypto, so there is no dependency to trust.
 */

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Codes one step early or late still count: phone clocks drift and typing takes time. */
export const TOTP_WINDOW = 1;
/** 160-bit secrets, as RFC 4226 recommends. */
const SECRET_BYTES = 20;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = (): string => base32Encode(randomBytes(SECRET_BYTES));

/** The code for one time step (RFC 4226's HOTP with the step as the counter). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', secret).update(message).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / TOTP_STEP_SECONDS);

export function totpAt(secretBase32: string, ms: number): string {
  return hotp(base32Decode(secretBase32), stepAt(ms));
}

/**
 * The step a code belongs to, within the window around `ms`, or null. Steps at or before
 * `lastStep` don't count: a code works once (a code seen over someone's shoulder can't be
 * used again).
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  ms: number,
  lastStep: number | null,
): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const secret = base32Decode(secretBase32);
  const now = stepAt(ms);
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqualString(hotp(secret, step), digits)) return step;
  }
  return null;
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The address authenticator apps read from the QR code (the Key Uri Format). */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/*
 * Secrets at rest: AES-256-GCM under the instance's secret key (a file in the data folder,
 * not in the database), so a copy of the database or of its backups alone doesn't give the
 * secrets away. Stored as `v1:<iv>:<tag>:<ciphertext>` in base64url.
 */

export function sealSecret(key: Buffer, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join(':');
}

/** The secret, or null when it can't be opened (another instance's key, a damaged value). */
export function openSecret(key: Buffer, sealed: string): string | null {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
