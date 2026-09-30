import { PASSWORD_MIN_LENGTH } from '@memora/shared';
import { ApiError } from '../errors';
import { isCommonPassword } from './common-passwords';

export interface HashParams {
  /** KiB. */
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Argon2id at OWASP's recommended memory setting (19 MiB), with extra passes instead of extra
 * memory: time cost raises the attacker's cost just as well and keeps the NAS's RAM free.
 * Stored hashes carry their own parameters; logins upgrade hashes made with older settings.
 */
export const DEFAULT_HASH_PARAMS: HashParams = { memoryCost: 19_456, timeCost: 8, parallelism: 1 };

/** Each hash holds `memoryCost` of RAM while it runs; cap how many run at once. */
const MAX_CONCURRENT_HASHES = 2;

let argon2: Promise<typeof import('@node-rs/argon2')> | undefined;
/** Loaded when first needed: the desktop app has no passwords and ships without it. */
const loadArgon2 = () => (argon2 ??= import('@node-rs/argon2'));

let running = 0;
const waiting: (() => void)[] = [];

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_HASHES) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

export class PasswordHasher {
  /** Verified against when a username doesn't exist, so response times don't reveal that. */
  private dummyHash: Promise<string> | undefined;

  constructor(readonly params: HashParams = DEFAULT_HASH_PARAMS) {}

  hash(password: string): Promise<string> {
    // `algorithm: 2` is Argon2id (the package's `Algorithm` const enum can't be imported here).
    return limited(async () =>
      (await loadArgon2()).hash(password, { algorithm: 2, ...this.params }),
    );
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await limited(async () => (await loadArgon2()).verify(storedHash, password));
    } catch {
      return false; // malformed hash
    }
  }

  /** Spends the same effort as a real check, for unknown usernames. Always false. */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash('memora-dummy-password');
    await this.verify(await this.dummyHash, password);
    return false;
  }

  needsRehash(storedHash: string): boolean {
    const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
    if (!match) return true;
    const [, m, t, p] = match.map(Number);
    return (
      m !== this.params.memoryCost || t !== this.params.timeCost || p !== this.params.parallelism
    );
  }
}

/**
 * The password rules (§9.1): long enough, not a well-known password, and not built from the
 * username. No arbitrary complexity rules. Throws a 400 `weak_password` explaining the problem.
 */
export function assertStrongPassword(password: string, username: string): void {
  const reject = (message: string) => {
    throw new ApiError(400, 'weak_password', message, { fields: { password: message } });
  };
  if (password.length < PASSWORD_MIN_LENGTH) {
    reject(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  const lower = password.toLowerCase();
  if (new Set(lower).size <= 2) {
    reject('Use more than one or two different characters.');
  }
  if (username.length >= 3 && lower.includes(username.toLowerCase())) {
    reject('Don’t include your username in your password.');
  }
  if (lower.includes('memora')) {
    reject('Don’t include the app’s name in your password.');
  }
  if (isCommonPassword(lower) || isSequence(lower)) {
    reject('This password is too common. Try a few unrelated words.');
  }
}

/** "123456789012", "abcdefghijkl" and the like, also reversed. */
function isSequence(value: string): boolean {
  const codes = Array.from(value, (c) => c.codePointAt(0) ?? 0);
  const steps = new Set(codes.slice(1).map((code, i) => code - codes[i]!));
  return steps.size === 1 && [1, -1].includes([...steps][0]!);
}
