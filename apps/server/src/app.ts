import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { HealthResponse } from '@memora/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';
import type { SqliteDatabase } from './db/client';

export interface AppOptions {
  config: Config;
  db: SqliteDatabase;
  version: string;
  /** Set to false in tests to keep output quiet. */
  logger?: boolean;
}

const notFoundBody = { error: { code: 'not_found', message: 'Not found' } };

export async function buildApp({
  config,
  db,
  version,
  logger = true,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    // `base: null` drops pid/hostname from every line: inside Docker they are noise.
    logger: logger ? { level: config.logLevel, base: null } : false,
  });

  // Unauthenticated on purpose (Docker health checks): reveals nothing beyond status and version.
  // Logged only on problems, so the periodic health check doesn't flood the container log.
  app.get('/api/health', { logLevel: 'warn' }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      db.prepare('SELECT 1').get();
    } catch (error) {
      app.log.error({ err: error }, 'health check: database unavailable');
      return reply.code(503).send({ status: 'error', version } satisfies HealthResponse);
    }
    return { status: 'ok', version } satisfies HealthResponse;
  });

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

  return app;
}
