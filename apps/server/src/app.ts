import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { HealthResponse } from '@memora/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { DEFAULT_HASH_PARAMS, PasswordHasher, type HashParams } from './auth/password';
import { registerAuth } from './auth/plugin';
import { AuthService } from './auth/service';
import type { Config } from './config';
import type { SqliteDatabase } from './db/client';
import { ApiError } from './errors';
import { EventHub } from './events/hub';
import { NotesService } from './notes/service';
import { createOrm, createRepos } from './repo';
import { adminRoutes } from './routes/admin';
import { authRoutes, type RouteDeps } from './routes/auth';
import { eventRoutes } from './routes/events';
import { notesRoutes } from './routes/notes';

export interface AppOptions {
  config: Config;
  db: SqliteDatabase;
  version: string;
  /** Set to false in tests to keep output quiet. */
  logger?: boolean;
  /** Tests move time forward to check session expiry. */
  now?: () => number;
  /** Tests use cheap hashing; production keeps the defaults. */
  hashParams?: HashParams;
}

declare module 'fastify' {
  interface FastifyInstance {
    authService: AuthService;
    events: EventHub;
  }
}

const notFoundBody = { error: { code: 'not_found', message: 'Not found' } };

/** Expired sessions and old audit entries are cleared at start and then every 6 hours. */
const MAINTENANCE_INTERVAL_MS = 6 * 3_600_000;
const AUDIT_MAX_AGE_MS = 365 * 24 * 3_600_000;
const AUDIT_MAX_ROWS = 50_000;

export async function buildApp({
  config,
  db,
  version,
  logger = true,
  now = Date.now,
  hashParams = DEFAULT_HASH_PARAMS,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    // `base: null` drops pid/hostname from every line: inside Docker they are noise.
    logger: logger
      ? {
          level: config.logLevel,
          base: null,
          // Never log credentials or session cookies (§11).
          redact: [
            'req.headers.cookie',
            'req.headers.authorization',
            'req.headers["x-csrf-token"]',
          ],
        }
      : false,
    // A hop count trusts that many proxies in front of Memora.
    trustProxy:
      typeof config.trustProxy === 'number'
        ? (
            (hops: number) => (_address: string, hop: number) =>
              hop < hops
          )(config.trustProxy)
        : config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  const orm = createOrm(db);
  const repos = createRepos(orm, now);
  const hasher = new PasswordHasher(hashParams);
  const auth = new AuthService(db, repos, hasher, config, now);
  const notes = new NotesService(db, orm, now);
  const events = new EventHub();
  const deps: RouteDeps = { db, repos, auth, notes, events, config, hasher, now };
  app.decorate('authService', auth);
  app.decorate('events', events);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      const retryAfter = (error.details as { retryAfter?: number } | undefined)?.retryAfter;
      if (error.statusCode === 429 && retryAfter) reply.header('Retry-After', String(retryAfter));
      return reply.code(error.statusCode).send(error.toBody());
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 400 && status < 500) {
      // Fastify's own client errors: malformed JSON, unsupported content type, body too large.
      return reply
        .code(status)
        .send(new ApiError(status, 'invalid_request', (error as Error).message).toBody());
    }
    request.log.error({ err: error }, 'request failed');
    return reply.code(500).send(new ApiError(500, 'internal', 'Something went wrong.').toBody());
  });

  registerAuth(app, auth, config, now);

  // Unauthenticated on purpose (Docker health checks): reveals nothing beyond status and version.
  // Logged only on problems, so the periodic health check doesn't flood the container log.
  app.get(
    '/api/health',
    { logLevel: 'warn', config: { access: 'public' } },
    async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      try {
        db.prepare('SELECT 1').get();
      } catch (error) {
        app.log.error({ err: error }, 'health check: database unavailable');
        return reply.code(503).send({ status: 'error', version } satisfies HealthResponse);
      }
      return { status: 'ok', version } satisfies HealthResponse;
    },
  );

  // Browsers send presence updates only: small messages.
  await app.register(fastifyWebsocket, { options: { maxPayload: 16 * 1024 } });

  authRoutes(app, deps);
  adminRoutes(app, deps);
  notesRoutes(app, deps);
  eventRoutes(app, deps);

  const hasWebApp = existsSync(join(config.webDir, 'index.html'));
  if (hasWebApp) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      setHeaders(reply, filePath) {
        // Vite puts content-hashed files in /assets, so they can be cached forever.
        reply.header(
          'Cache-Control',
          filePath.includes(`${sep}assets${sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    });
  } else {
    app.log.info({ webDir: config.webDir }, 'web app not built — serving the API only');
  }

  app.setNotFoundHandler((request, reply) => {
    const isPageRequest =
      hasWebApp &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      !request.url.startsWith('/api/');
    if (isPageRequest) {
      // Client-side routes (e.g. /p/<id>) all load the single-page app.
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send(notFoundBody);
  });

  let maintenance: NodeJS.Timeout | undefined;
  const runMaintenance = () => {
    try {
      repos.sessions.deleteExpired();
      repos.audit.prune(AUDIT_MAX_AGE_MS, AUDIT_MAX_ROWS);
    } catch (error) {
      app.log.warn({ err: error }, 'maintenance failed');
    }
  };
  app.addHook('onReady', async () => {
    runMaintenance();
    maintenance = setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS);
    maintenance.unref();
  });
  app.addHook('onClose', async () => clearInterval(maintenance));

  return app;
}
