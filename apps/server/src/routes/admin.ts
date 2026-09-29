import {
  createUserRequestSchema,
  updateUserRequestSchema,
  type AuditPage,
  type TemporaryPasswordResponse,
} from '@memora/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { newTemporaryPassword } from '../auth/tokens';
import type { UserRow } from '../db/schema';
import { ApiError, notFound, parse } from '../errors';
import { authOf, type RouteDeps } from './auth';

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().max(64).optional(),
});

const lastAdmin = () =>
  new ApiError(409, 'last_admin', 'Memora needs at least one active administrator.');

export function adminRoutes(app: FastifyInstance, { db, repos, hasher, now }: RouteDeps): void {
  const config = { access: 'admin' as const };

  const findUser = (id: string): UserRow => {
    const user = repos.users.findById(id);
    if (!user) throw notFound('User not found.');
    return user;
  };

  /** True when `user` is the only admin who can still log in. */
  const isLastActiveAdmin = (user: UserRow) =>
    user.role === 'admin' && user.disabledAt === null && repos.users.countActiveAdmins() <= 1;

  app.get('/api/v1/admin/users', { config }, async () => repos.users.listForAdmin());

  app.post('/api/v1/admin/users', { config }, async (request, reply) => {
    const admin = authOf(request).user;
    const body = parse(createUserRequestSchema, request.body);
    if (repos.users.findByUsername(body.username)) {
      throw new ApiError(409, 'username_taken', 'That username is taken.', {
        fields: { username: 'That username is taken.' },
      });
    }
    const temporaryPassword = newTemporaryPassword();
    const user = repos.users.create({
      username: body.username,
      displayName: body.displayName,
      role: body.role,
      passwordHash: await hasher.hash(temporaryPassword),
      mustChangePassword: true,
    });
    repos.audit.record('user_created', {
      userId: admin.id,
      username: admin.username,
      ip: request.ip,
      meta: { targetId: user.id, target: user.username, role: user.role },
    });
    return reply.code(201).send({
      user: repos.users.adminView(user),
      temporaryPassword,
    } satisfies TemporaryPasswordResponse);
  });

  app.patch<{ Params: { id: string } }>('/api/v1/admin/users/:id', { config }, async (request) => {
    const admin = authOf(request).user;
    const body = parse(updateUserRequestSchema, request.body);
    const target = findUser(request.params.id);
    const self = target.id === admin.id;

    const demoting = body.role === 'user' && target.role === 'admin';
    const disabling = body.disabled === true && target.disabledAt === null;
    if (self && (demoting || disabling)) {
      throw new ApiError(409, 'conflict', 'You can’t remove your own admin rights or access.');
    }
    if ((demoting || disabling) && isLastActiveAdmin(target)) throw lastAdmin();

    const updated = db.transaction(() => {
      const row = repos.users.update(target.id, {
        ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
        ...(body.role === undefined ? {} : { role: body.role }),
        ...(body.disabled === undefined
          ? {}
          : { disabledAt: body.disabled ? (target.disabledAt ?? now()) : null }),
      });
      if (disabling) repos.sessions.deleteAllForUser(target.id);
      return row;
    })();

    const enabling = body.disabled === false && target.disabledAt !== null;
    const event = disabling ? 'user_disabled' : enabling ? 'user_enabled' : 'user_updated';
    repos.audit.record(event, {
      userId: admin.id,
      username: admin.username,
      ip: request.ip,
      meta: { targetId: target.id, target: target.username, changes: Object.keys(body) },
    });
    return repos.users.adminView(updated ?? target);
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/users/:id/reset-password',
    { config },
    async (request) => {
      const admin = authOf(request).user;
      const target = findUser(request.params.id);
      if (target.id === admin.id) {
        throw new ApiError(409, 'conflict', 'Change your own password on the Account page.');
      }
      const temporaryPassword = newTemporaryPassword();
      const passwordHash = await hasher.hash(temporaryPassword);
      const updated = db.transaction(() => {
        const row = repos.users.update(target.id, { passwordHash, mustChangePassword: true });
        repos.sessions.deleteAllForUser(target.id);
        return row;
      })();
      repos.audit.record('password_reset', {
        userId: admin.id,
        username: admin.username,
        ip: request.ip,
        meta: { targetId: target.id, target: target.username },
      });
      return {
        user: repos.users.adminView(updated ?? target),
        temporaryPassword,
      } satisfies TemporaryPasswordResponse;
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/users/:id',
    { config },
    async (request, reply) => {
      const admin = authOf(request).user;
      const target = findUser(request.params.id);
      if (target.id === admin.id) {
        throw new ApiError(409, 'conflict', 'You can’t delete your own account.');
      }
      if (isLastActiveAdmin(target)) throw lastAdmin();
      repos.users.delete(target.id);
      repos.audit.record('user_deleted', {
        userId: admin.id,
        username: admin.username,
        ip: request.ip,
        meta: { targetId: target.id, target: target.username },
      });
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/admin/audit', { config }, async (request) => {
    const query = parse(auditQuerySchema, request.query);
    return repos.audit.page(query.limit, query.before) satisfies AuditPage;
  });
}
