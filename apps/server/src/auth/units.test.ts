import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { ApiError } from '../errors';
import { parseCookies, serializeCookie } from '../http/cookies';
import { deviceLabel } from './device';
import { DEFAULT_HASH_PARAMS, PasswordHasher, assertStrongPassword } from './password';
import { RateLimit, Throttle } from './throttle';
import {
  csrfTokenFor,
  hashToken,
  newReadableCode,
  newSessionToken,
  newTemporaryPassword,
  normalizeReadableCode,
} from './tokens';

const reason = (password: string, username = 'alex') => {
  try {
    assertStrongPassword(password, username);
    return 'ok';
  } catch (error) {
    return error instanceof ApiError ? error.message : String(error);
  }
};

describe('password rules', () => {
  it.each([
    ['violet-harbour-lantern', 'ok'],
    ['correct horse battery staple', 'ok'],
    ['short-pass', /at least 12/],
    ['aaaaaaaaaaaaaaaa', /more than one or two/],
    ['abababababababab', /more than one or two/],
    ['my-name-is-alex!', /username/],
    ['MY-NAME-IS-ALEX!', /username/],
    ['i-love-memora-notes', /app’s name/],
    ['qwerty123456', /too common/],
    ['1Q2W3E4R5T6Y', /too common/],
    ['123456789012', /too common/],
    ['zyxwvutsrqpo', /too common/],
  ])('%s → %s', (password, expected) => {
    const result = reason(password);
    if (expected === 'ok') expect(result).toBe('ok');
    else expect(result).toMatch(expected);
  });
});

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher({ memoryCost: 256, timeCost: 1, parallelism: 1 });

  it('hashes with Argon2id and verifies', async () => {
    const hash = await hasher.hash('violet-harbour-lantern');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=256,t=1,p=1\$/);
    expect(await hasher.verify(hash, 'violet-harbour-lantern')).toBe(true);
    expect(await hasher.verify(hash, 'violet-harbour-lanterns')).toBe(false);
    expect(await hasher.verify('not a hash', 'x')).toBe(false);
    expect(await hasher.verifyDummy('x')).toBe(false);
  });

  it('asks for a rehash when the settings changed', async () => {
    const hash = await hasher.hash('x');
    expect(hasher.needsRehash(hash)).toBe(false);
    expect(new PasswordHasher().needsRehash(hash)).toBe(true);
    expect(hasher.needsRehash('$2b$10$bcrypt')).toBe(true);
  });

  it('defaults to OWASP’s memory setting for Argon2id', () => {
    expect(DEFAULT_HASH_PARAMS).toMatchObject({ memoryCost: 19_456, parallelism: 1 });
    expect(DEFAULT_HASH_PARAMS.timeCost).toBeGreaterThanOrEqual(2);
  });
});

describe('Throttle', () => {
  it('allows free attempts, then doubles the wait', () => {
    let now = 0;
    const throttle = new Throttle({ freeAttempts: 2, baseDelayMs: 1000 }, () => now);
    throttle.fail('k');
    throttle.fail('k');
    expect(throttle.retryAfter('k')).toBe(0);
    throttle.fail('k');
    expect(throttle.retryAfter('k')).toBe(1000);
    throttle.fail('k');
    expect(throttle.retryAfter('k')).toBe(2000);
    throttle.fail('k');
    expect(throttle.retryAfter('k')).toBe(4000);
    now += 4000;
    expect(throttle.retryAfter('k')).toBe(0);
    expect(throttle.retryAfter('other')).toBe(0);
  });

  it('caps the wait and forgets after a quiet hour', () => {
    let now = 0;
    const throttle = new Throttle({ freeAttempts: 0, maxDelayMs: 5000 }, () => now);
    for (let i = 0; i < 20; i += 1) throttle.fail('k');
    expect(throttle.retryAfter('k')).toBe(5000);
    now += 60 * 60_000 + 1;
    throttle.fail('k');
    expect(throttle.retryAfter('k')).toBe(1000);
  });

  it('forgives one attempt and resets fully', () => {
    const throttle = new Throttle({ freeAttempts: 1 }, () => 0);
    throttle.fail('k');
    throttle.fail('k');
    expect(throttle.retryAfter('k')).toBeGreaterThan(0);
    throttle.forgive('k');
    expect(throttle.retryAfter('k')).toBe(0);
    throttle.reset('k');
    throttle.fail('k');
    expect(throttle.retryAfter('k')).toBe(0);
  });

  it('keeps memory bounded', () => {
    const throttle = new Throttle({ freeAttempts: 0, maxEntries: 3 }, () => 0);
    for (const k of ['a', 'b', 'c', 'd']) throttle.fail(k);
    expect(throttle.retryAfter('a')).toBe(0); // evicted
    expect(throttle.retryAfter('d')).toBeGreaterThan(0);
  });
});

describe('RateLimit', () => {
  it('counts per window and key', () => {
    let now = 0;
    const limit = new RateLimit(2, 1000, () => now);
    expect(limit.hit('ip')).toBe(0);
    expect(limit.hit('ip')).toBe(0);
    expect(limit.hit('ip')).toBe(1000);
    expect(limit.hit('other')).toBe(0);
    now = 1000;
    expect(limit.hit('ip')).toBe(0);
  });
});

describe('tokens', () => {
  it('makes 256-bit session tokens and hashes them', () => {
    const token = newSessionToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(csrfTokenFor(token)).not.toBe(csrfTokenFor(newSessionToken()));
  });

  it('makes readable codes and forgives typing slips', () => {
    const code = newReadableCode(3);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(normalizeReadableCode(' 7kq2-mx9d o1l ')).toBe('7KQ2MX9D011');
    expect(newTemporaryPassword()).toHaveLength(19);
  });
});

describe('deviceLabel', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
      'Firefox on Linux',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    [
      'Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
    ['curl/8.9.1', 'curl'],
    [undefined, 'Unknown device'],
  ])('%s → %s', (ua, label) => {
    expect(deviceLabel(ua)).toBe(label);
  });
});

describe('cookies', () => {
  it('parses a Cookie header', () => {
    const cookies = parseCookies('a=1; __Host-memora_session=abc; b="quoted"; a=2');
    expect(cookies.get('a')).toBe('1');
    expect(cookies.get('__Host-memora_session')).toBe('abc');
    expect(cookies.get('b')).toBe('quoted');
    expect(parseCookies(undefined).size).toBe(0);
  });

  it('serialises with the hardening flags', () => {
    expect(serializeCookie('s', 'v', { secure: true, maxAge: 60.7 })).toBe(
      's=v; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60',
    );
    expect(serializeCookie('s', '', { secure: false, maxAge: 0 })).toBe(
      's=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
    );
  });
});

describe('auth configuration', () => {
  it('has the documented defaults', () => {
    const config = loadConfig({});
    expect(config.sessionRememberMs).toBe(30 * 24 * 3_600_000);
    expect(config.sessionMs).toBe(12 * 3_600_000);
    expect(config.trustProxy).toEqual(['loopback', 'linklocal', 'uniquelocal']);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['2', 2],
    ['192.0.2.1, 198.51.100.0/24', ['192.0.2.1', '198.51.100.0/24']],
  ])('reads MEMORA_TRUST_PROXY=%s', (value, expected) => {
    expect(loadConfig({ MEMORA_TRUST_PROXY: value }).trustProxy).toEqual(expected);
  });

  it('reads the session lengths', () => {
    const config = loadConfig({ MEMORA_SESSION_DAYS: '7', MEMORA_SESSION_HOURS: '2' });
    expect(config.sessionRememberMs).toBe(7 * 24 * 3_600_000);
    expect(config.sessionMs).toBe(2 * 3_600_000);
  });
});
