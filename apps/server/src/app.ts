import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import {
  API_CONTENT_SECURITY_POLICY,
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
  type HealthResponse,
} from '@memora/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { DEFAULT_FETCH_POLICY, type FetchPolicy } from './assets/fetch';
import { cleanUnusedAssets } from './assets/cleanup';
import { AssetsService } from './assets/service';
import { BackupService } from './backup/service';
import { DEFAULT_HASH_PARAMS, PasswordHasher, type HashParams } from './auth/password';
import { registerAuth } from './auth/plugin';
import { loadSecretKey } from './auth/secretKey';
import { AuthService } from './auth/service';
import { TwoFactorService } from './auth/twoFactor';
import type { Config } from './config';
import type { SqliteDatabase } from './db/client';
import { dataIdOf } from './db/meta';
import { ApiError } from './errors';
import { EventHub } from './events/hub';
import { NotesService } from './notes/service';
import { TemplatesService } from './notes/templates';
import { createOrm, createRepos } from './repo';
import { adminRoutes } from './routes/admin';
import { assetRoutes } from './routes/assets';
import { authRoutes, type RouteDeps } from './routes/auth';
import { backupRoutes } from './routes/backups';
import { eventRoutes } from './routes/events';
import { notesRoutes } from './routes/notes';
import { searchRoutes } from './routes/search';
import { SearchService } from './search/service';
import { kanbanRoutes } from './routes/kanban';
import { transferRoutes } from './routes/transfer';
import { KanbanService } from './kanban/service';
import { JobService } from './transfer/jobs';
import { syncRoutes } from './routes/sync';
import type { VaultKdf } from './sync/crypto';
import { SealedFileSecretStore, type SecretStore } from './sync/secrets';
import { SyncService } from './sync/service';
import type { GoogleEndpoints } from './sync/stores/gdrive';

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
  /** Tests download images from a local server; production blocks local addresses. */
  fetchPolicy?: FetchPolicy;
  /**
   * Restarts Memora (after a restore is ready). The server's entry point closes it and exits
   * so the container restarts it; tests just note the request.
   */
  onRestart?: () => void;
  /** The instance's secret key; read from `config.secretKeyFile` when first needed otherwise. */
  secretKey?: Buffer;
  /**
   * Where sync keeps its sign-in and key (ADR 0006): the desktop app's main process. Without
   * one, a file sealed with the instance key (development and tests).
   */
  secretStore?: SecretStore;
  /** The system's folder picker, through the desktop app. */
  pickFolder?: () => Promise<string | null>;
  /** Tests: Google's addresses, WebDAV over http on this computer, runs started by hand. */
  syncTesting?: {
    googleEndpoints?: GoogleEndpoints;
    allowHttp?: boolean;
    timers?: boolean;
    partBytes?: number;
    kdf?: VaultKdf;
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    authService: AuthService;
    events: EventHub;
    sync: SyncService;
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
  fetchPolicy = DEFAULT_FETCH_POLICY,
  onRestart = () => undefined,
  secretKey,
  secretStore,
  pickFolder,
  syncTesting,
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
            'req.headers["x-memora-archive-password"]',
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
  const twoFactor = new TwoFactorService(
    db,
    () => secretKey ?? loadSecretKey(config.secretKeyFile),
    now,
  );
  const auth = new AuthService(db, repos, hasher, config, now, twoFactor);
  const notes = new NotesService(db, orm, now);
  const search = new SearchService(db, now);
  const templates = new TemplatesService(orm, now);
  const events = new EventHub();
  const assets = new AssetsService(db, orm, now);
  const backups = new BackupService(
    db,
    config,
    {
      info: (obj, msg) => app.log.info(obj, msg),
      error: (obj, msg) => app.log.error(obj, msg),
    },
    now,
  );
  const kanban = new KanbanService(db, now);
  const instanceKey = () => secretKey ?? loadSecretKey(config.secretKeyFile);
  const sync = new SyncService({
    db,
    config,
    events,
    notes,
    secrets:
      secretStore ??
      new SealedFileSecretStore(join(config.dataDir, 'sync-secrets.enc'), instanceKey),
    ...(pickFolder ? { pickFolder } : {}),
    owner: () => auth.ensureDesktopOwner().id,
    log: {
      info: (obj, msg) => app.log.info(obj, msg),
      warn: (obj, msg) => app.log.warn(obj, msg),
    },
    now,
    version,
    google: {
      client: config.googleClient,
      ...(syncTesting?.googleEndpoints ? { endpoints: syncTesting.googleEndpoints } : {}),
    },
    ...(syncTesting?.allowHttp ? { allowHttp: true } : {}),
    ...(syncTesting?.timers === false ? { timers: false } : {}),
    ...(syncTesting?.partBytes ? { partBytes: syncTesting.partBytes } : {}),
    ...(syncTesting?.kdf ? { kdf: syncTesting.kdf } : {}),
  });
  const jobs = new JobService(join(config.dataDir, 'tmp', 'jobs'), events, now, (error, job) =>
    app.log.warn({ err: error, job: job.id, kind: job.kind }, 'job failed'),
  );
  let dataId: string | undefined;
  const deps: RouteDeps = {
    db,
    repos,
    auth,
    notes,
    search,
    templates,
    assets,
    fetchPolicy,
    backups,
    dataId: () => (dataId ??= dataIdOf(db)),
    restart: onRestart,
    events,
    config,
    hasher,
    now,
  };
  app.decorate('authService', auth);
  app.decorate('events', events);
  app.decorate('sync', sync);

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

  if (config.desktop) {
    // The desktop app listens on this computer only. A web page elsewhere could still point a
    // name of its own at 127.0.0.1 ("DNS rebinding"): only this address is answered.
    const hosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`]);
    app.addHook('onRequest', async (request, reply) => {
      if (!hosts.has(request.headers.host ?? '')) {
        return reply
          .code(421)
          .send(new ApiError(421, 'forbidden', 'Memora answers on this computer only.').toBody());
      }
      // No service worker: it keeps the app for when the server can't be reached, and this one
      // is always there. Without it, the app also starts each new version as it's installed.
      if (request.url.split('?')[0] === '/sw.js') {
        return reply.code(404).send(new ApiError(404, 'not_found', 'Not found.').toBody());
      }
    });
  }

  registerAuth(app, auth, config, now);

  // Security headers on every answer (§11). Routes that set a stricter policy keep theirs.
  app.addHook('onSend', async (request, reply) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    if (!reply.hasHeader('content-security-policy')) {
      reply.header(
        'Content-Security-Policy',
        request.url.startsWith('/api/') ? API_CONTENT_SECURITY_POLICY : CONTENT_SECURITY_POLICY,
      );
    }
    if (request.protocol === 'https') {
      reply.header('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY);
    }
  });

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
  searchRoutes(app, deps);
  backupRoutes(app, deps);
  await assetRoutes(app, deps);
  await transferRoutes(app, { ...deps, jobs, version });
  kanbanRoutes(app, { ...deps, kanban });
  syncRoutes(app, { ...deps, sync });
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
  let assetsCleanedAt = 0;
  const runMaintenance = () => {
    try {
      repos.sessions.deleteExpired();
      repos.audit.prune(AUDIT_MAX_AGE_MS, AUDIT_MAX_ROWS);
      // History and the recycle bin (§9.7), then files nothing uses any more.
      const thinned = notes.thinVersions(config.historyRetention);
      const purged = notes.purgeExpired(now() - config.trashMs);
      let cleaned = 0;
      // With sync on, only once this computer has all the notes: a file whose page hasn't
      // arrived yet isn't unused.
      if ((purged.removed > 0 || now() - assetsCleanedAt > 24 * 3_600_000) && sync.settled()) {
        cleaned = cleanUnusedAssets(db, now());
        assetsCleanedAt = now();
      }
      void jobs
        .expire()
        .catch((error: unknown) => app.log.warn({ err: error }, 'removing old exports failed'));
      if (thinned || purged.removed || cleaned) {
        app.log.info(
          { versionsThinned: thinned, rowsPurged: purged.removed, filesRemoved: cleaned },
          'maintenance',
        );
      }
    } catch (error) {
      app.log.warn({ err: error }, 'maintenance failed');
    }
  };
  // The desktop app catches up on the backup it missed while it was closed, a minute in.
  let catchUp: NodeJS.Timeout | undefined;
  sync.onCleanup = () => {
    try {
      cleanUnusedAssets(db, now());
      assetsCleanedAt = now();
    } catch (error) {
      app.log.warn({ err: error }, 'removing unused files failed');
    }
  };
  app.addHook('onReady', async () => {
    await jobs.prepare();
    await sync.start();
    runMaintenance();
    maintenance = setInterval(runMaintenance, MAINTENANCE_INTERVAL_MS);
    maintenance.unref();
    backups.start();
    if (config.desktop) {
      catchUp = setTimeout(() => void backups.catchUp().catch(() => undefined), 60_000);
      catchUp.unref();
    }
  });
  app.addHook('onClose', async () => {
    // What changed in the last moments goes to the sync folder before Memora closes.
    await sync.stop(true);
    clearInterval(maintenance);
    clearTimeout(catchUp);
    backups.stop();
  });

  return app;
}
