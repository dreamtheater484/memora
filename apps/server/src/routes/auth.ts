import {
  changePasswordRequestSchema,
  loginRequestSchema,
  setupRequestSchema,
  updateProfileRequestSchema,
  type MeResponse,
  type SessionInfo,
  type SessionResponse,
} from '@memora/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PasswordHasher } from '../auth/password';
import { requestMeta } from '../auth/plugin';
import { toCurrentUser, type AuthContext, type AuthService } from '../auth/service';
import { csrfTokenFor } from '../auth/tokens';
import type { Config } from '../config';
import type { FetchPolicy } from '../assets/fetch';
import type { BackupService } from '../backup/service';
import type { AssetsService } from '../assets/service';
import type { SqliteDatabase } from '../db/client';
import type { EventHub } from '../events/hub';
import { notFound, parse } from '../errors';
import type { NotesService } from '../notes/service';
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
  events: EventHub;
  config: Config;
  hasher: PasswordHasher;
  now: () => number;
}

/** Routes with `access: 'user'` or `'admin'` only run with a session (checked in the hook). */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new Error('route needs access: user or admin');
  return request.auth;
}

export function authRoutes(app: FastifyInstance, { auth, repos, dataId }: RouteDeps): void {
  const signedIn = (
    request: FastifyRequest,
    reply: FastifyReply,
    result: Pick<AuthContext, 'user' | 'session' | 'token'>,
  ): SessionResponse => {
    app.sessionCookies.set(request, reply, result);
    return { user: toCurrentUser(result.user), csrfToken: csrfTokenFor(result.token) };
  };

  app.get('/api/v1/auth/me', { config: { access: 'public' } }, async (request) => {
    const current = request.auth;
    return {
      setupRequired: current ? false : auth.isSetupRequired(),
      user: current ? toCurrentUser(current.user) : null,
      csrfToken: current ? csrfTokenFor(current.token) : null,
      ...(current ? { dataId: dataId() } : {}),
    } satisfies MeResponse;
  });

  app.post('/api/v1/auth/setup', { config: { access: 'public' } }, async (request, reply) => {
    const body = parse(setupRequestSchema, request.body);
    const result = await auth.setup(body, requestMeta(request));
    request.log.info({ userId: result.user.id }, 'first admin account created');
    return signedIn(request, reply, result);
  });

  app.post('/api/v1/auth/login', { config: { access: 'public' } }, async (request, reply) => {
    const body = parse(loginRequestSchema, request.body);
    const result = await auth.login(body, requestMeta(request));
    return signedIn(request, reply, result);
  });

  app.post(
    '/api/v1/auth/logout',
    { config: { access: 'user', allowPendingPasswordChange: true } },
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
    { config: { access: 'user', allowPendingPasswordChange: true } },
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
    return toCurrentUser(user ?? current.user);
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
}
