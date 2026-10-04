import {
  enableSyncSchema,
  googleClientSchema,
  PASSWORD_MAX_LENGTH,
  type SyncStatus,
} from '@memora/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../errors';
import type { SyncService } from '../sync/service';
import { authOf, type RouteDeps } from './auth';

/*
 * Settings → Sync (ADR 0006, the desktop app): choosing the folder, the passphrase, the state
 * of sync, and turning it off. Credentials go in and never come back out.
 */

const passwordSchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) });

const callbackSchema = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(200).optional(),
  error: z.string().max(200).optional(),
});

/** The page Google's sign-in ends on, in the computer's browser: plain, and nothing to run. */
function callbackPage(ok: boolean, message: string): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Memora</title></head><body><h1>${ok ? 'Connected' : 'Not connected'}</h1><p>${escape(message)}</p></body></html>`;
}

export function syncRoutes(app: FastifyInstance, deps: RouteDeps & { sync: SyncService }): void {
  const { sync, repos } = deps;
  const config = { access: 'admin' as const };
  const audit = (request: FastifyRequest, event: 'sync_enabled' | 'sync_disabled', meta = {}) => {
    const { user } = authOf(request);
    repos.audit.record(event, { userId: user.id, username: user.username, ip: request.ip, meta });
  };

  app.get('/api/v1/sync', { config }, async (_request, reply): Promise<SyncStatus> => {
    reply.header('Cache-Control', 'no-store');
    await sync.loadSecrets();
    return sync.status();
  });

  app.post('/api/v1/sync/connect', { config }, async (request) => sync.connect(request.body));

  app.post('/api/v1/sync/cancel', { config }, async () => sync.cancel());

  app.post('/api/v1/sync/pick-folder', { config }, async () => ({ path: await sync.pickFolder() }));

  app.post('/api/v1/sync/google/start', { config }, async () => ({
    url: await sync.googleStart(),
  }));

  // Google sends the browser back here: no session in that browser, so the one-time `state`
  // Memora gave it is what proves the sign-in is Memora's own.
  app.get(
    '/api/v1/sync/google/callback',
    // Not in the log: its address carries the one-time code (useless without PKCE's verifier,
    // and spent at once, but a log is no place for it).
    { config: { access: 'public' }, logLevel: 'warn' },
    async (request, reply) => {
      const query = parse(callbackSchema, request.query);
      const result = await sync.googleCallback(query);
      return reply
        .header('Cache-Control', 'no-store')
        .header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
        .type('text/html; charset=utf-8')
        .code(result.ok ? 200 : 400)
        .send(callbackPage(result.ok, result.message));
    },
  );

  app.put('/api/v1/sync/google-client', { config }, async (request) =>
    sync.setGoogleClient(parse(googleClientSchema, request.body)),
  );

  app.delete('/api/v1/sync/google-client', { config }, async () => sync.setGoogleClient(null));

  app.post('/api/v1/sync/enable', { config }, async (request) => {
    const { passphrase } = parse(enableSyncSchema, request.body);
    const status = await sync.enable(passphrase);
    audit(request, 'sync_enabled', { provider: status.provider });
    return status;
  });

  app.post('/api/v1/sync/password', { config }, async (request) =>
    sync.updatePassword(parse(passwordSchema, request.body).password),
  );

  app.post('/api/v1/sync/resume', { config }, async () => sync.resume());

  app.post('/api/v1/sync/now', { config }, async () => sync.syncNow());

  app.delete('/api/v1/sync', { config }, async (request) => {
    const status = await sync.disconnect();
    audit(request, 'sync_disabled');
    return status;
  });
}
