/**
 * In-memory attempt limits with growing delays (§11 brute-force protection).
 *
 * After `freeAttempts` failures, each further failure doubles the wait before the next attempt
 * (1 s, 2 s, 4 s, … up to `maxDelayMs`). Failures are forgotten after `forgetAfterMs` without
 * one. The map is capped, so an attacker cycling through keys can't grow memory without bound;
 * the oldest entries go first.
 */
export interface ThrottleOptions {
  freeAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  forgetAfterMs?: number;
  maxEntries?: number;
}

interface Entry {
  failures: number;
  lastFailureAt: number;
  blockedUntil: number;
}

export class Throttle {
  private readonly entries = new Map<string, Entry>();
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly forgetAfterMs: number;
  private readonly maxEntries: number;

  constructor(
    private readonly options: ThrottleOptions,
    private readonly now: () => number = Date.now,
  ) {
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 15 * 60_000;
    this.forgetAfterMs = options.forgetAfterMs ?? 60 * 60_000;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  /** Milliseconds until `key` may try again; 0 when it may try now. */
  retryAfter(key: string): number {
    const entry = this.current(key);
    return entry ? Math.max(0, entry.blockedUntil - this.now()) : 0;
  }

  fail(key: string): void {
    const now = this.now();
    const entry = this.current(key) ?? { failures: 0, lastFailureAt: now, blockedUntil: 0 };
    entry.failures += 1;
    entry.lastFailureAt = now;
    const over = entry.failures - this.options.freeAttempts;
    if (over > 0) {
      entry.blockedUntil = now + Math.min(this.baseDelayMs * 2 ** (over - 1), this.maxDelayMs);
    }
    // Re-insert so Map order stays "least recently failed first".
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /**
   * Takes back one failure. Attempts are counted *before* the (slow) password check, so a
   * burst of parallel requests can't all slip through; a successful attempt is then forgiven.
   */
  forgive(key: string): void {
    const entry = this.current(key);
    if (!entry) return;
    entry.failures = Math.max(0, entry.failures - 1);
    if (entry.failures <= this.options.freeAttempts) entry.blockedUntil = 0;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private current(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry && this.now() - entry.lastFailureAt > this.forgetAfterMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }
}

/**
 * A fixed-window request counter per key, for the API-wide limit. Windows are short, so the
 * whole map is simply dropped when a new window starts.
 */
export class RateLimit {
  private counts = new Map<string, number>();
  private windowStart = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Counts one request; returns the milliseconds to wait when over the limit, else 0. */
  hit(key: string): number {
    const now = this.now();
    if (now - this.windowStart >= this.windowMs) {
      this.counts = new Map();
      this.windowStart = now;
    }
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return count > this.limit ? this.windowStart + this.windowMs - now : 0;
  }
}
