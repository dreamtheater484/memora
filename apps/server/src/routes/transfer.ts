import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  exportRequestSchema,
  idSchema,
  importQuerySchema,
  pdfRequestSchema,
  uuidv7,
  type ExportOptions,
} from '@memora/shared';
import type { FastifyInstance } from 'fastify';
import { ApiError, parse } from '../errors';
import { writeArchive } from '../transfer/archive';
import { collect } from '../transfer/collect';
import { importFile } from '../transfer/importer';
import type { JobService } from '../transfer/jobs';
import { writeMarkdown } from '../transfer/markdown';
import { renderPdf } from '../transfer/pdf';
import { authOf, type RouteDeps } from './auth';

type Id = { Params: { id: string } };

/** `filename*` keeps any name; the plain `filename` is an ASCII stand-in for old clients. */
function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** An archive's password travels in a header, never in the address (which is logged). */
export const PASSWORD_HEADER = 'x-memora-archive-password';

/** Limits on what an archive may unpack to: generous, but no zip bomb gets through. */
const MAX_ENTRIES = 200_000;

/**
 * Import and export (§9.10): `POST /exports` and `POST /imports` start background jobs,
 * `GET /jobs` lists them and `GET /jobs/:id/download` answers an export's file. PDFs are
 * made by Gotenberg when one is configured (`POST /exports/pdf`).
 */
export async function transferRoutes(
  app: FastifyInstance,
  deps: RouteDeps & { jobs: JobService; version: string },
): Promise<void> {
  const { db, jobs, assets, backups, config, events, notes, now } = deps;
  const access = { access: 'user' as const };
  const uploads = join(jobs.dir, '.uploads');

  app.get('/api/v1/exports/options', { config: access }, async () => {
    return { pdf: !!config.gotenbergUrl } satisfies ExportOptions;
  });

  app.post('/api/v1/exports', { config: access }, async (request, reply) => {
    const { user } = authOf(request);
    const body = parse(exportRequestSchema, request.body);
    // Checked now, so a wrong id fails the request rather than the job.
    const collected = collect(db, user.id, body.scope, body.id);
    const options = { appVersion: deps.version, history: body.history, password: body.password };
    const job = jobs.start(user.id, 'export', 'Waiting to start', (context) =>
      body.format === 'memora'
        ? writeArchive(db, user.id, collected, { ...options, now: now() }, context)
        : writeMarkdown(db, user.id, collected, now(), context),
    );
    return reply.code(202).send(job);
  });

  app.get('/api/v1/jobs', { config: access }, async (request) => {
    return jobs.list(authOf(request).user.id);
  });

  app.get<Id>('/api/v1/jobs/:id', { config: access }, async (request) => {
    return jobs.get(authOf(request).user.id, parse(idSchema, request.params.id));
  });

  app.get<Id>('/api/v1/jobs/:id/download', { config: access }, async (request, reply) => {
    const file = jobs.file(authOf(request).user.id, parse(idSchema, request.params.id));
    return reply
      .header('Content-Disposition', attachment(file.name))
      .header('Cache-Control', 'no-store')
      .type('application/octet-stream')
      .send(createReadStream(file.path));
  });

  await app.register(async (scope) => {
    // The body is the file, streamed to disk as it arrives rather than held in memory.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, payload, done) => done(null, payload));
    scope.post('/api/v1/imports', { config: access }, async (request, reply) => {
      const { user } = authOf(request);
      const query = parse(importQuerySchema, request.query);
      const header = request.headers[PASSWORD_HEADER];
      const password = typeof header === 'string' && header ? header : undefined;
      if (query.notebookId) {
        const found = db
          .prepare('SELECT 1 FROM notebooks WHERE id = ? AND owner_id = ? AND deleted_at IS NULL')
          .get(query.notebookId, user.id);
        if (!found) throw new ApiError(404, 'not_found', 'Notebook not found.');
      }
      const limit = config.maxImportBytes;
      const tooLarge = () =>
        new ApiError(
          413,
          'invalid_request',
          `This file is larger than ${Math.round(limit / 1024 / 1024)} MB, the largest Memora imports.`,
        );
      if (Number(request.headers['content-length'] ?? 0) > limit) throw tooLarge();
      await mkdir(uploads, { recursive: true });
      const path = join(uploads, uuidv7(now()));
      let size = 0;
      try {
        await pipeline(
          request.body as Readable,
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              size += chunk.length;
              if (size > limit) callback(tooLarge());
              else callback(null, chunk);
            },
          }),
          createWriteStream(path),
        );
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      }
      if (size === 0) {
        await rm(path, { force: true });
        throw new ApiError(400, 'invalid_request', 'The file is empty.');
      }
      const job = jobs.start(user.id, 'import', 'Waiting to start', async (context) => {
        try {
          // Merging changes what is there: a backup first, to go back to.
          if (query.notebookId) {
            context.progress(0, 'Backing up first');
            await backups.create('pre-import');
          }
          const importReport = await importFile(
            {
              db,
              assets,
              now,
              limits: {
                maxEntries: MAX_ENTRIES,
                maxEntryBytes: Math.max(config.maxUploadBytes, 64 * 1024 * 1024),
                maxTotalBytes: Math.max(limit * 8, 1024 * 1024 * 1024),
              },
            },
            { path, name: query.name },
            { owner: user.id, inboxId: notes.inbox(user.id).id, notebookId: query.notebookId },
            password,
            context,
          );
          events.publish(user.id, { type: 'tree.changed', origin: null });
          return { importReport };
        } finally {
          await rm(path, { force: true });
        }
      });
      return reply.code(202).send(job);
    });
  });

  app.post(
    '/api/v1/exports/pdf',
    { config: access, bodyLimit: 32 * 1024 * 1024 },
    async (request, reply) => {
      const { user } = authOf(request);
      if (!config.gotenbergUrl) {
        throw new ApiError(
          404,
          'not_found',
          'PDFs are made in the browser: no PDF service is set up.',
        );
      }
      const body = parse(pdfRequestSchema, request.body);
      const pdf = await renderPdf(config.gotenbergUrl, assets, user.id, body);
      return reply
        .header('Content-Disposition', attachment(`${body.name}.pdf`))
        .header('Cache-Control', 'no-store')
        .type('application/pdf')
        .send(pdf);
    },
  );
}
