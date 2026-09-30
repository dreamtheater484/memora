import { RECOVERY_CODES, uuidv7, type TwoFactorSetup, type TwoFactorStatus } from '@memora/shared';
import type { SqliteDatabase } from '../db/client';
import type { UserRow } from '../db/schema';
import { ApiError } from '../errors';
import { hashToken, newReadableCode, newSessionToken, normalizeReadableCode } from './tokens';
import { newTotpSecret, openSecret, otpauthUri, sealSecret, verifyTotp } from './totp';

/*
 * Two-step verification (§11, Phase 12): an authenticator app's codes, recovery codes for when
 * the phone is lost, the second step of a login, and an administrator's "required for
 * everyone". Secrets are sealed with the instance's key; recovery codes are stored hashed.
 */

/** A password that was right waits this long for its code. */
const TICKET_MS = 5 * 60_000;
/** Wrong codes one login may try before starting again from the password. */
const TICKET_TRIES = 5;
/** Logins waiting for their code at once, at most (they are small, and expire). */
const MAX_TICKETS = 1_000;

const REQUIRE_KEY = 'require_two_factor';

export interface Ticket {
  userId: string;
  remember: boolean;
  expiresAt: number;
  tries: number;
}

export type Verified = 'app' | 'recovery';

export class TwoFactorService {
  private readonly tickets = new Map<string, Ticket>();
  /** Asked on every request (the gate in the auth hook), so kept in memory. */
  private requiredCache: boolean | undefined;

  private sealingKey: Buffer | undefined;

  constructor(
    private readonly db: SqliteDatabase,
    /** Read when first needed (the server reads it at start, to fail early). */
    private readonly loadKey: () => Buffer,
    private readonly now: () => number,
  ) {}

  private get key(): Buffer {
    return (this.sealingKey ??= this.loadKey());
  }

  /** An administrator requires two-step verification of everyone. */
  required(): boolean {
    if (this.requiredCache === undefined) {
      const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(REQUIRE_KEY) as
        { value: string } | undefined;
      this.requiredCache = row?.value === '1';
    }
    return this.requiredCache;
  }

  setRequired(on: boolean): void {
    this.db
      .prepare(
        'INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(REQUIRE_KEY, on ? '1' : '0');
    this.requiredCache = on;
  }

  mustSetUp(user: UserRow): boolean {
    return !user.totpEnabled && this.required();
  }

  status(user: UserRow): TwoFactorStatus {
    return {
      enabled: user.totpEnabled,
      recoveryCodesLeft: user.totpEnabled ? this.codesLeft(user.id) : 0,
      required: this.required(),
    };
  }

  private codesLeft(userId: string): number {
    const { n } = this.db
      .prepare('SELECT count(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
      .get(userId) as { n: number };
    return n;
  }

  /** A new secret for the authenticator app; it counts once `enable` gets a code from it. */
  begin(user: UserRow, issuer: string): TwoFactorSetup {
    if (user.totpEnabled) {
      throw new ApiError(409, 'two_factor_on', 'Two-step verification is on already.');
    }
    const secret = newTotpSecret();
    this.db
      .prepare(
        'UPDATE users SET totp_secret_enc = ?, totp_last_step = NULL, updated_at = ? WHERE id = ?',
      )
      .run(sealSecret(this.key, secret), this.now(), user.id);
    return { secret, uri: otpauthUri(secret, user.username, issuer) };
  }

  /** Turns it on with a code from the app just set up; answers the recovery codes. */
  enable(user: UserRow, code: string): string[] {
    if (user.totpEnabled) {
      throw new ApiError(409, 'two_factor_on', 'Two-step verification is on already.');
    }
    const secret = user.totpSecretEnc ? openSecret(this.key, user.totpSecretEnc) : null;
    if (!secret) {
      throw new ApiError(409, 'two_factor_not_started', 'Start the set-up again.');
    }
    const step = verifyTotp(secret, code, this.now(), null);
    if (step === null) throw wrongCode();
    return this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE users SET totp_enabled = 1, totp_last_step = ?, updated_at = ? WHERE id = ?',
        )
        .run(step, this.now(), user.id);
      return this.newRecoveryCodes(user.id);
    })();
  }

  disable(userId: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = NULL, updated_at = ? WHERE id = ?',
        )
        .run(this.now(), userId);
      this.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
    })();
  }

  /** New recovery codes; the old ones stop working. */
  newRecoveryCodes(userId: string): string[] {
    const now = this.now();
    const codes = Array.from({ length: RECOVERY_CODES }, () => newReadableCode(3).toLowerCase());
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId);
      const add = this.db.prepare(
        'INSERT INTO recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)',
      );
      for (const code of codes) add.run(uuidv7(now), userId, hashCode(code), now);
    })();
    return codes;
  }

  /**
   * Checks a code from the app (each one works once), or a recovery code (used up by this).
   * A secret sealed with another instance's key can't be opened: then only recovery codes
   * work, and the user can set the app up again.
   */
  verify(user: UserRow, code: string): Verified | null {
    const secret = user.totpSecretEnc ? openSecret(this.key, user.totpSecretEnc) : null;
    if (secret) {
      const step = verifyTotp(secret, code, this.now(), user.totpLastStep);
      if (step !== null) {
        // Only moves forward: two requests racing with the same code can't both win.
        const { changes } = this.db
          .prepare(
            'UPDATE users SET totp_last_step = ? WHERE id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)',
          )
          .run(step, user.id, step);
        return changes ? 'app' : null;
      }
    }
    if (/^\d{6}$/.test(code.replace(/\s/g, ''))) return null;
    const { changes } = this.db
      .prepare(
        'UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
      )
      .run(this.now(), user.id, hashCode(code));
    return changes ? 'recovery' : null;
  }

  /** After the right password: a ticket the code must come with. */
  challenge(userId: string, remember: boolean): string {
    this.sweep();
    const ticket = newSessionToken();
    this.tickets.set(hashToken(ticket), {
      userId,
      remember,
      expiresAt: this.now() + TICKET_MS,
      tries: 0,
    });
    return ticket;
  }

  /** The login a ticket belongs to; counts a try, and forgets the ticket when used up. */
  ticket(ticket: string): Ticket | null {
    const key = hashToken(ticket);
    const found = this.tickets.get(key);
    if (!found || found.expiresAt <= this.now()) {
      this.tickets.delete(key);
      return null;
    }
    found.tries += 1;
    if (found.tries >= TICKET_TRIES) this.tickets.delete(key);
    return found;
  }

  /** A ticket that led to a session is done. */
  finish(ticket: string): void {
    this.tickets.delete(hashToken(ticket));
  }

  private sweep() {
    const now = this.now();
    for (const [key, t] of this.tickets) if (t.expiresAt <= now) this.tickets.delete(key);
    // Never unbounded: the oldest go first.
    while (this.tickets.size >= MAX_TICKETS) {
      this.tickets.delete(this.tickets.keys().next().value!);
    }
  }
}

const hashCode = (code: string) => hashToken(normalizeReadableCode(code));

export const wrongCode = () =>
  new ApiError(400, 'invalid_code', 'That code is not right. Codes change every 30 seconds.', {
    fields: { code: 'That code is not right.' },
  });
