import { createReadStream } from 'node:fs';
import type { BackupInfo } from '@memora/shared';
import type { FastifyInstance } from 'fastify';
import { authOf, type RouteDeps } from './auth';

type Name = { Params: { name: string } };

/**
 * Admin → Backups (§9.14): the list and the schedule, "back up now", downloading, deleting
 * and restoring. A restore backs up first, then Memora restarts to put the backup in place.
 */
export function backupRoutes(app: FastifyInstance, { backups, repos, restart }: RouteDeps): void {
  const config = { access: 'admin' as const };
  const audit = (
    request: Parameters<typeof authOf>[0],
    event: 'backup_created' | 'backup_downloaded' | 'backup_restored',
    backup: string,
  ) => {
    const { user } = authOf(request);
    repos.audit.record(event, {
      userId: user.id,
      username: user.username,
      ip: request.ip,
      meta: { backup },
    });
  };

  app.get('/api/v1/admin/backups', { config }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return backups.status();
  });

  app.post('/api/v1/admin/backups', { config }, async (request, reply) => {
    const info: BackupInfo = await backups.create('manual');
    audit(request, 'backup_created', info.name);
    return reply.code(201).send(info);
  });

  app.get<Name>('/api/v1/admin/backups/:name', { config }, async (request, reply) => {
    const file = backups.pathOf(request.params.name);
    audit(request, 'backup_downloaded', request.params.name);
    return reply
      .header('Cache-Control', 'no-store')
      .header('Content-Disposition', `attachment; filename="${request.params.name}"`)
      .type('application/octet-stream')
      .send(createReadStream(file));
  });

  app.delete<Name>('/api/v1/admin/backups/:name', { config }, async (request, reply) => {
    await backups.remove(request.params.name);
    return reply.code(204).send();
  });

  app.post<Name>('/api/v1/admin/backups/:name/restore', { config }, async (request, reply) => {
    const started = await backups.prepareRestore(request.params.name);
    audit(request, 'backup_restored', request.params.name);
    // Answer first; then Memora closes and the container starts it again.
    reply.raw.once('finish', () => setTimeout(restart, 200));
    return started;
  });
}
