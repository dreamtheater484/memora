import {
  createTemplateSchema,
  searchQuerySchema,
  setPageTagsSchema,
  uiStateSchema,
  updateTagSchema,
  updateTemplateSchema,
} from '@memora/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../errors';
import { authOf, type RouteDeps } from './auth';

type Id = { Params: { id: string } };

/** Search, tags, links between pages and templates (§9.8, §9.9). */
export function searchRoutes(
  app: FastifyInstance,
  { notes, search, templates, repos }: RouteDeps,
): void {
  const config = { access: 'user' as const };
  /** Routes that change the tree: the user's other browsers hear about it (§9.6). */
  const changes = { access: 'user' as const, emits: 'tree' as const };
  const owner = (request: Parameters<typeof authOf>[0]) => authOf(request).user.id;

  /** The pages the user opened lately, for the ranking. */
  const recentPages = (userId: string): string[] => {
    const ui = uiStateSchema.safeParse(repos.settings.get(userId, 'ui') ?? {});
    return ui.success
      ? (ui.data.recent ?? []).filter((r) => r.type === 'page').map((r) => r.id)
      : [];
  };

  app.get('/api/v1/search', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const userId = owner(request);
    return search.search(userId, parse(searchQuerySchema, request.query), recentPages(userId));
  });

  app.get<Id>('/api/v1/pages/:id/backlinks', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { pages: notes.backlinks(owner(request), request.params.id) };
  });

  // Tags

  app.put<Id>('/api/v1/pages/:id/tags', { config: changes }, async (request) =>
    notes.setPageTags(
      owner(request),
      request.params.id,
      parse(setPageTagsSchema, request.body).names,
    ),
  );

  app.patch<Id>('/api/v1/tags/:id', { config: changes }, async (request) =>
    notes.updateTag(owner(request), request.params.id, parse(updateTagSchema, request.body)),
  );

  app.delete<Id>('/api/v1/tags/:id', { config: changes }, async (request) =>
    notes.deleteTag(owner(request), request.params.id),
  );

  // Templates

  app.get('/api/v1/templates', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return templates.list(owner(request));
  });

  app.post('/api/v1/templates', { config }, async (request, reply) => {
    const created = templates.create(owner(request), parse(createTemplateSchema, request.body));
    return reply.code(201).send(created);
  });

  app.patch<Id>('/api/v1/templates/:id', { config }, async (request) =>
    templates.update(owner(request), request.params.id, parse(updateTemplateSchema, request.body)),
  );

  app.delete<Id>('/api/v1/templates/:id', { config }, async (request, reply) => {
    templates.remove(owner(request), request.params.id);
    return reply.code(204).send();
  });
}
