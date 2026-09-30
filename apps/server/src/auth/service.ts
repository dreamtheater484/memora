import type {
  ChangePasswordRequest,
  CurrentUser,
  LoginRequest,
  SetupRequest,
  TwoFactorLoginRequest,
} from '@memora/shared';
import type { Config } from '../config';
import type { SqliteDatabase } from '../db/client';
import type { SessionRow, UserRow } from '../db/schema';
import { ApiError } from '../errors';
import type { Repos } from '../repo';
import { deviceLabel } from './device';
import { assertStrongPassword, type PasswordHasher } from './password';
import { Throttle } from './throttle';
import { type TwoFactorService, wrongCode } from './twoFactor';
import {
  hashToken,
  newReadableCode,
  newSessionToken,
  normalizeReadableCode,
  safeEqual,
} from './tokens';

/** Where a request came from, for sessions and the audit log. */
export interface RequestMeta {
  ip: string;
  userAgent: string | undefined;
}

export interface AuthContext {
  user: UserRow;
  session: SessionRow;
  token: string;
  /** The idle expiry moved forward on this request (so a persistent cookie is re-sent). */
  renewed: boolean;
}

export interface NewSessionResult {
  user: UserRow;
  session: SessionRow;
  token: string;
}

/** The password was right; the code from the authenticator app comes next. */
export interface CodeNeeded {
  ticket: string;
}

/** However often it is used, a session ends after this long; you log in again. */
const ABSOLUTE_SESSION_MS = 90 * 24 * 3_600_000;
/** Sliding renewal writes at most this often per session: every write is a disk flush. */
export const TOUCH_INTERVAL_MS = 5 * 60_000;

export const toCurrentUser = (user: UserRow, twoFactorRequired = false): CurrentUser => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
  mustChangePassword: user.mustChangePassword,
  twoFactor: user.totpEnabled,
  mustSetUpTwoFactor: twoFactorRequired && !user.totpEnabled,
});

export function tooManyAttempts(waitMs: number): ApiError {
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  return new ApiError(
    429,
    'too_many_requests',
    `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
    { retryAfter: seconds },
  );
}

export class AuthService {
  /** The first-run setup code (§9.1): only in memory, printed to the log, new on each start. */
  private setupCode: string | null = null;

  readonly loginByUsername: Throttle;
  readonly loginByIp: Throttle;
  readonly setupByIp: Throttle;
  /**
   * Wrong codes per account. Not reset by a right password: someone who has the password
   * still waits longer and longer between guesses at the code.
   */
  readonly codeByUser: Throttle;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly repos: Repos,
    readonly hasher: PasswordHasher,
    private readonly config: Config,
    private readonly now: () => number,
    readonly twoFactor: TwoFactorService,
  ) {
    this.loginByUsername = new Throttle({ freeAttempts: 5 }, now);
    this.loginByIp = new Throttle({ freeAttempts: 20 }, now);
    this.setupByIp = new Throttle({ freeAttempts: 5 }, now);
    this.codeByUser = new Throttle({ freeAttempts: 5 }, now);
  }

  /** The signed-in user as the web app sees it. */
  currentUser(user: UserRow): CurrentUser {
    return toCurrentUser(user, this.twoFactor.required());
  }

  isSetupRequired(): boolean {
    return this.config.desktop === null && this.repos.users.count() === 0;
  }

  /**
   * The desktop app's owner (Phase 14): made on the first start, as an admin without a
   * password (the stored value can't match any password; the window signs in with the
   * launch secret instead).
   */
  ensureDesktopOwner(): UserRow {
    const existing = this.repos.users.firstActiveAdmin();
    if (existing) return existing;
    const name = this.config.desktop?.name ?? 'Me';
    const user = this.repos.users.create({
      username: 'me',
      displayName: name,
      passwordHash: '!desktop',
      role: 'admin',
      mustChangePassword: false,
    });
    this.repos.audit.record('setup_completed', { userId: user.id, username: user.username });
    return user;
  }

  /** Signs the desktop app's window in, when it presents the secret it started Memora with. */
  desktopSession(token: string, meta: RequestMeta): NewSessionResult {
    const expected = this.config.desktop?.token;
    if (!expected || !safeEqual(token, expected)) {
      throw new ApiError(403, 'forbidden', 'This link only works in the Memora app.');
    }
    return this.createSession(this.ensureDesktopOwner(), true, meta);
  }

  /** Returns the setup code to print when the instance has no users yet, else null. */
  startSetupIfNeeded(): string | null {
    if (!this.isSetupRequired()) {
      this.setupCode = null;
      return null;
    }
    this.setupCode ??= newReadableCode(3);
    return this.setupCode;
  }

  /** Creates the first (admin) account. Needs the setup code from the server log. */
  async setup(input: SetupRequest, meta: RequestMeta): Promise<NewSessionResult> {
    if (!this.isSetupRequired()) {
      throw new ApiError(409, 'already_set_up', 'Memora is already set up. Log in instead.');
    }
    const wait = this.setupByIp.retryAfter(meta.ip);
    if (wait > 0) throw tooManyAttempts(wait);
    this.setupByIp.fail(meta.ip);

    const expected = this.setupCode;
    if (
      !expected ||
      !safeEqual(normalizeReadableCode(input.setupCode), normalizeReadableCode(expected))
    ) {
      throw new ApiError(
        403,
        'invalid_setup_code',
        'That setup code is not right. The current code is in the server log.',
        { fields: { setupCode: 'That code is not right.' } },
      );
    }
    this.setupByIp.forgive(meta.ip);

    assertStrongPassword(input.password, input.username);
    const passwordHash = await this.hasher.hash(input.password);

    // Re-checked inside the transaction: two setups racing can't both create an admin.
    const user = this.db.transaction(() => {
      if (this.repos.users.count() > 0) {
        throw new ApiError(409, 'already_set_up', 'Memora is already set up. Log in instead.');
      }
      return this.repos.users.create({
        username: input.username,
        displayName: input.displayName,
        passwordHash,
        role: 'admin',
        mustChangePassword: false,
      });
    })();
    this.setupCode = null;
    this.setupByIp.reset(meta.ip);

    this.repos.audit.record('setup_completed', {
      userId: user.id,
      username: user.username,
      ip: meta.ip,
    });
    return this.createSession(user, true, meta);
  }

  async login(input: LoginRequest, meta: RequestMeta): Promise<NewSessionResult | CodeNeeded> {
    const username = input.username.trim().toLowerCase();
    const wait = Math.max(
      this.loginByIp.retryAfter(meta.ip),
      this.loginByUsername.retryAfter(username),
    );
    if (wait > 0) throw tooManyAttempts(wait);
    this.loginByIp.fail(meta.ip);
    this.loginByUsername.fail(username);

    const user = this.repos.users.findByUsername(username);
    const valid = user
      ? await this.hasher.verify(user.passwordHash, input.password)
      : await this.hasher.verifyDummy(input.password);

    if (!user || !valid) {
      this.repos.audit.record('login_failed', {
        userId: user?.id ?? null,
        username,
        ip: meta.ip,
        meta: { reason: user ? 'wrong_password' : 'unknown_user' },
      });
      throw new ApiError(401, 'invalid_credentials', 'Wrong username or password.');
    }
    if (user.disabledAt !== null) {
      this.repos.audit.record('login_failed', {
        userId: user.id,
        username,
        ip: meta.ip,
        meta: { reason: 'disabled' },
      });
      throw new ApiError(
        403,
        'account_disabled',
        'This account is disabled. Ask an administrator.',
      );
    }

    this.loginByUsername.reset(username);
    this.loginByIp.forgive(meta.ip);
    let current = user;
    if (this.hasher.needsRehash(user.passwordHash)) {
      current =
        this.repos.users.update(user.id, {
          passwordHash: await this.hasher.hash(input.password),
        }) ?? user;
    }
    if (current.totpEnabled) {
      const wait = this.codeByUser.retryAfter(user.id);
      if (wait > 0) throw tooManyAttempts(wait);
      return { ticket: this.twoFactor.challenge(user.id, input.remember ?? false) };
    }
    const result = this.createSession(current, input.remember ?? false, meta);
    this.repos.audit.record('login', {
      userId: user.id,
      username,
      ip: meta.ip,
      meta: { device: result.session.deviceLabel, remember: result.session.remember },
    });
    return result;
  }

  /** The second step of a login: the code from the authenticator app, or a recovery code. */
  loginWithCode(input: TwoFactorLoginRequest, meta: RequestMeta): NewSessionResult {
    const ticket = this.twoFactor.ticket(input.ticket);
    const user = ticket ? this.repos.users.findById(ticket.userId) : undefined;
    if (!ticket || !user || user.disabledAt !== null) {
      throw new ApiError(401, 'login_expired', 'That took too long. Log in again.');
    }
    const wait = this.codeByUser.retryAfter(user.id);
    if (wait > 0) throw tooManyAttempts(wait);
    this.codeByUser.fail(user.id);

    const verified = this.twoFactor.verify(user, input.code);
    if (!verified) {
      this.repos.audit.record('login_failed', {
        userId: user.id,
        username: user.username,
        ip: meta.ip,
        meta: { reason: 'wrong_code' },
      });
      throw wrongCode();
    }
    this.codeByUser.reset(user.id);
    this.twoFactor.finish(input.ticket);
    const result = this.createSession(user, ticket.remember, meta);
    if (verified === 'recovery') {
      this.repos.audit.record('recovery_code_used', {
        userId: user.id,
        username: user.username,
        ip: meta.ip,
      });
    }
    this.repos.audit.record('login', {
      userId: user.id,
      username: user.username,
      ip: meta.ip,
      meta: {
        device: result.session.deviceLabel,
        remember: result.session.remember,
        twoFactor: verified,
      },
    });
    return result;
  }

  /** Asks for the password again before a change to how the account is protected. */
  async confirmPassword(user: UserRow, password: string): Promise<void> {
    const wait = this.loginByUsername.retryAfter(user.username);
    if (wait > 0) throw tooManyAttempts(wait);
    this.loginByUsername.fail(user.username);
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      throw new ApiError(400, 'wrong_password', 'That password is not right.', {
        fields: { password: 'That password is not right.' },
      });
    }
    this.loginByUsername.reset(user.username);
  }

  createSession(user: UserRow, remember: boolean, meta: RequestMeta): NewSessionResult {
    const now = this.now();
    const token = newSessionToken();
    const session = this.repos.sessions.create({
      userId: user.id,
      tokenHash: hashToken(token),
      remember,
      expiresAt: now + (remember ? this.config.sessionRememberMs : this.config.sessionMs),
      absoluteExpiresAt: now + Math.max(ABSOLUTE_SESSION_MS, this.config.sessionRememberMs),
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip,
      deviceLabel: deviceLabel(meta.userAgent),
    });
    return { user, session, token };
  }

  /**
   * Whether a session is still good, without renewing it: for connections that stay open
   * (the event channel), which must not keep an idle session alive on their own.
   */
  isActive(sessionId: string): boolean {
    const found = this.repos.sessions.findById(sessionId);
    if (!found) return false;
    const { session, user } = found;
    const now = this.now();
    return (
      session.expiresAt > now &&
      session.absoluteExpiresAt > now &&
      user.disabledAt === null &&
      !user.mustChangePassword &&
      !this.twoFactor.mustSetUp(user)
    );
  }

  /** Finds the session for a cookie token, ending it if it has expired. Renews it (sliding). */
  resolve(token: string): AuthContext | null {
    if (token.length > 128) return null;
    const found = this.repos.sessions.findByTokenHash(hashToken(token));
    if (!found) return null;
    const { user } = found;
    let { session } = found;
    const now = this.now();
    if (session.expiresAt <= now || session.absoluteExpiresAt <= now || user.disabledAt !== null) {
      this.repos.sessions.deleteById(session.id);
      return null;
    }
    let renewed = false;
    if (now - session.lastSeenAt >= TOUCH_INTERVAL_MS) {
      const idle = session.remember ? this.config.sessionRememberMs : this.config.sessionMs;
      const expiresAt = Math.min(now + idle, session.absoluteExpiresAt);
      this.repos.sessions.touch(session.id, now, expiresAt);
      session = { ...session, lastSeenAt: now, expiresAt };
      renewed = true;
    }
    return { user, session, token, renewed };
  }

  /**
   * Changes the signed-in user's password. Signs out every other device and rotates the
   * current session's token (§11); returns the new token.
   */
  async changePassword(
    auth: AuthContext,
    input: ChangePasswordRequest,
    meta: RequestMeta,
  ): Promise<NewSessionResult> {
    const { user } = auth;
    const wait = this.loginByUsername.retryAfter(user.username);
    if (wait > 0) throw tooManyAttempts(wait);
    this.loginByUsername.fail(user.username);
    if (!(await this.hasher.verify(user.passwordHash, input.currentPassword))) {
      throw new ApiError(400, 'wrong_password', 'Your current password is not right.', {
        fields: { currentPassword: 'This is not your current password.' },
      });
    }
    this.loginByUsername.reset(user.username);
    if (input.newPassword === input.currentPassword) {
      throw new ApiError(400, 'weak_password', 'Choose a password you haven’t used here yet.', {
        fields: { newPassword: 'Choose a password you haven’t used here yet.' },
      });
    }
    try {
      assertStrongPassword(input.newPassword, user.username);
    } catch (error) {
      // Same check, reported on the field the form calls "new password".
      if (error instanceof ApiError) {
        throw new ApiError(400, 'weak_password', error.message, {
          fields: { newPassword: error.message },
        });
      }
      throw error;
    }
    const passwordHash = await this.hasher.hash(input.newPassword);
    const token = newSessionToken();
    const updated = this.db.transaction(() => {
      const row = this.repos.users.update(user.id, { passwordHash, mustChangePassword: false });
      this.repos.sessions.deleteAllForUser(user.id, auth.session.id);
      this.repos.sessions.rotate(auth.session.id, hashToken(token));
      return row;
    })();
    this.repos.audit.record('password_changed', {
      userId: user.id,
      username: user.username,
      ip: meta.ip,
    });
    const session = { ...auth.session, tokenHash: hashToken(token) };
    return { user: updated ?? user, session, token };
  }
}
