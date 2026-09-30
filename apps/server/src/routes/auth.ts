import {
  changePasswordRequestSchema,
  confirmPasswordSchema,
  enableTwoFactorSchema,
  loginRequestSchema,
  setupRequestSchema,
  twoFactorLoginSchema,
  updateProfileRequestSchema,
  type LoginResponse,
  type MeResponse,
  type RecoveryCodesResponse,
  type SessionInfo,
  type SessionResponse,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from '@memora/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PasswordHasher } from '../auth/password';
import { requestMeta } from '../auth/plugin';
import { type AuthContext, type AuthService } from '../auth/service';
import { csrfTokenFor } from '../auth/tokens';
import type { Config } from '../config';
import type { FetchPolicy } from '../assets/fetch';
import type { BackupService } from '../backup/service';
import type { AssetsService } from '../assets/service';
import type { SqliteDatabase } from '../db/client';
import type { EventHub } from '../events/hub';
import { ApiError, notFound, parse } from '../errors';
import type { NotesService } from '../notes/service';
import type { TemplatesService } from '../notes/templates';
import type { SearchService } from '../search/service';
import type { Repos } from '../repo';

export interface RouteDeps {
  db: SqliteDatabase;
  assets: AssetsService;
  /** How remote images are downloaded (tests allow their local server). */
  fetchPolicy: FetchPolicy;
  backups: BackupService;
  /** The id of the data as it is (new after a restore). */
  dataId: () => string;
  /** Restarts Memora, to put a restored backup in place. */
  restart: () => void;
  repos: Repos;
  auth: AuthService;
  notes: NotesService;
  search: SearchService;
  templates: TemplatesService;
  events: EventHub;
  config: Config;
  hasher: PasswordHasher;
  now: () => number;
}

/** Passwords and first-run setup don't exist in the desktop app. */
const notInDesktop = () =>
  new ApiError(404, 'not_found', 'The Memora app signs you in by itself: there are no passwords.');

/** Routes with `access: 'user'` or `'admin'` only run with a session (checked in the hook). */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new Error('route needs access: user or admin');
  return request.auth;
}

/** A path in this app to go to after signing in: never another site (`//host`, `/\\host`). */
const localPath = (value: unknown) =>
  typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/';

export function authRoutes(app: FastifyInstance, { auth, repos, dataId, config }: RouteDeps): void {
  const signedIn = (
    request: FastifyRequest,
    reply: FastifyReply,
    result: Pick<AuthContext, 'user' | 'session' | 'token'>,
  ): SessionResponse => {
    app.sessionCookies.set(request, reply, result);
    return { user: auth.currentUser(result.user), csrfToken: csrfTokenFor(result.token) };
  };

  app.get('/api/v1/auth/me', { config: { access: 'public' } }, async (request) => {
    const current = request.auth;
    return {
      setupRequired: current ? false : auth.isSetupRequired(),
      user: current ? auth.currentUser(current.user) : null,
      csrfToken: current ? csrfTokenFor(current.token) : null,
      ...(current ? { dataId: dataId() } : {}),
      ...(config.desktop ? { desktop: true } : {}),
    } satisfies MeResponse;
  });

  if (config.desktop) {
    // The desktop app's window opens this with the secret it started Memora with, and lands
    // in the app signed in (Phase 14). There are no passwords to log in with.
    app.get<{ Querystring: { token?: string; next?: string } }>(
      '/api/v1/auth/desktop',
      { config: { access: 'public' } },
      async (request, reply) => {
        const result = auth.desktopSession(request.query.token ?? '', requestMeta(request));
        app.sessionCookies.set(request, reply, result);
        return reply.redirect(localPath(request.query.next), 303);
      },
    );
  }

  app.post('/api/v1/auth/setup', { config: { access: 'public' } }, async (request, reply) => {
    if (config.desktop) throw notInDesktop();
    const body = parse(setupRequestSchema, request.body);
    const result = await auth.setup(body, requestMeta(request));
    request.log.info({ userId: result.user.id }, 'first admin account created');
    return signedIn(request, reply, result);
  });

  app.post('/api/v1/auth/login', { config: { access: 'public' } }, async (request, reply) => {
    if (config.desktop) throw notInDesktop();
    const body = parse(loginRequestSchema, request.body);
    const result = await auth.login(body, requestMeta(request));
    if ('ticket' in result) {
      return { twoFactorRequired: true, ticket: result.ticket } satisfies LoginResponse;
    }
    return signedIn(request, reply, result) satisfies LoginResponse;
  });

  app.post(
    '/api/v1/auth/login/two-factor',
    { config: { access: 'public' } },
    async (request, reply) => {
      const body = parse(twoFactorLoginSchema, request.body);
      return signedIn(request, reply, auth.loginWithCode(body, requestMeta(request)));
    },
  );

  app.post(
    '/api/v1/auth/logout',
    { config: { access: 'user', allowPendingPasswordChange: true, allowPendingTwoFactor: true } },
    async (request, reply) => {
      const current = authOf(request);
      repos.sessions.deleteForUser(current.user.id, current.session.id);
      repos.audit.record('logout', {
        userId: current.user.id,
        username: current.user.username,
        ip: request.ip,
      });
      app.sessionCookies.clear(reply);
      return reply.code(204).send();
    },
  );

  app.post(
    '/api/v1/auth/password',
    { config: { access: 'user', allowPendingPasswordChange: true, allowPendingTwoFactor: true } },
    async (request, reply) => {
      const body = parse(changePasswordRequestSchema, request.body);
      const result = await auth.changePassword(authOf(request), body, requestMeta(request));
      return signedIn(request, reply, result);
    },
  );

  app.patch('/api/v1/auth/me', { config: { access: 'user' } }, async (request) => {
    const current = authOf(request);
    const body = parse(updateProfileRequestSchema, request.body);
    const user = repos.users.update(current.user.id, { displayName: body.displayName });
    repos.audit.record('profile_updated', {
      userId: current.user.id,
      username: current.user.username,
      ip: request.ip,
    });
    return auth.currentUser(user ?? current.user);
  });

  app.get('/api/v1/auth/sessions', { config: { access: 'user' } }, async (request) => {
    const current = authOf(request);
    return repos.sessions.listForUser(current.user.id).map((s): SessionInfo => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      ip: s.ip,
      remember: s.remember,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: s.id === current.session.id,
    }));
  });

  app.delete<{ Params: { id: string } }>(
    '/api/v1/auth/sessions/:id',
    { config: { access: 'user' } },
    async (request, reply) => {
      const current = authOf(request);
      if (!repos.sessions.deleteForUser(current.user.id, request.params.id)) {
        throw notFound('Session not found.');
      }
      repos.audit.record('session_revoked', {
        userId: current.user.id,
        username: current.user.username,
        ip: request.ip,
        meta: { sessionId: request.params.id },
      });
      if (request.params.id === current.session.id) app.sessionCookies.clear(reply);
      return reply.code(204).send();
    },
  );

  // Two-step verification (§11). Changes ask for the password again: a session left open on
  // a shared computer must not be enough to lock the owner out.
  const pendingTwoFactor = { access: 'user' as const, allowPendingTwoFactor: true };
  const record = (
    request: FastifyRequest,
    event: 'two_factor_enabled' | 'two_factor_disabled' | 'recovery_codes_created',
  ) => {
    const { user } = authOf(request);
    repos.audit.record(event, { userId: user.id, username: user.username, ip: request.ip });
  };
  const notOn = () => new ApiError(409, 'two_factor_off', 'Two-step verification is off.');

  app.get('/api/v1/auth/two-factor', { config: pendingTwoFactor }, async (request) => {
    return auth.twoFactor.status(authOf(request).user) satisfies TwoFactorStatus;
  });

  app.post('/api/v1/auth/two-factor/setup', { config: pendingTwoFactor }, async (request) => {
    const { user } = authOf(request);
    const body = parse(confirmPasswordSchema, request.body);
    await auth.confirmPassword(user, body.password);
    return auth.twoFactor.begin(user, 'Memora') satisfies TwoFactorSetup;
  });

  app.post('/api/v1/auth/two-factor/enable', { config: pendingTwoFactor }, async (request) => {
    const current = authOf(request);
    const body = parse(enableTwoFactorSchema, request.body);
    const codes = auth.twoFactor.enable(current.user, body.code);
    // Other devices signed in with the password alone: they sign in again, with a code.
    repos.sessions.deleteAllForUser(current.user.id, current.session.id);
    record(request, 'two_factor_enabled');
    return { codes } satisfies RecoveryCodesResponse;
  });

  app.post(
    '/api/v1/auth/two-factor/recovery-codes',
    { config: { access: 'user' } },
    async (request) => {
      const { user } = authOf(request);
      const body = parse(confirmPasswordSchema, request.body);
      await auth.confirmPassword(user, body.password);
      if (!user.totpEnabled) throw notOn();
      const codes = auth.twoFactor.newRecoveryCodes(user.id);
      record(request, 'recovery_codes_created');
      return { codes } satisfies RecoveryCodesResponse;
    },
  );

  app.post(
    '/api/v1/auth/two-factor/disable',
    { config: { access: 'user' } },
    async (request, reply) => {
      const { user } = authOf(request);
      const body = parse(confirmPasswordSchema, request.body);
      await auth.confirmPassword(user, body.password);
      if (!user.totpEnabled) throw notOn();
      auth.twoFactor.disable(user.id);
      record(request, 'two_factor_disabled');
      return reply.code(204).send();
    },
  );
}
