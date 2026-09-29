import {
  createGroupSchema,
  createNotebookSchema,
  createPageSchema,
  createSectionSchema,
  deletePagesSchema,
  moveGroupSchema,
  moveNotebookSchema,
  moveSectionSchema,
  placePagesSchema,
  restoreSchema,
  uiStateSchema,
  updateGroupSchema,
  updateNotebookSchema,
  updatePageSchema,
  updateSectionSchema,
  updateSettingsSchema,
  type Settings,
  type UiState,
} from '@memora/shared';
import type { FastifyInstance } from 'fastify';
import { parse } from '../errors';
import { authOf, type RouteDeps } from './auth';

type Id = { Params: { id: string } };

/** Notebooks, section groups, sections, pages, the recycle bin and per-user settings. */
export function notesRoutes(app: FastifyInstance, { notes, repos }: RouteDeps): void {
  const config = { access: 'user' as const };
  const owner = (request: Parameters<typeof authOf>[0]) => authOf(request).user.id;

  app.get('/api/v1/tree', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return notes.tree(owner(request));
  });

  // Notebooks

  app.post('/api/v1/notebooks', { config }, async (request, reply) => {
    const body = parse(createNotebookSchema, request.body);
    return reply.code(201).send(notes.createNotebook(owner(request), body));
  });

  app.patch<Id>('/api/v1/notebooks/:id', { config }, async (request) =>
    notes.updateNotebook(
      owner(request),
      request.params.id,
      parse(updateNotebookSchema, request.body),
    ),
  );

  app.post<Id>('/api/v1/notebooks/:id/move', { config }, async (request) =>
    notes.moveNotebook(
      owner(request),
      request.params.id,
      parse(moveNotebookSchema, request.body).beforeId,
    ),
  );

  app.delete<Id>('/api/v1/notebooks/:id', { config }, async (request) =>
    notes.deleteNotebook(owner(request), request.params.id),
  );

  // Section groups

  app.post('/api/v1/groups', { config }, async (request, reply) => {
    const body = parse(createGroupSchema, request.body);
    return reply.code(201).send(notes.createGroup(owner(request), body));
  });

  app.patch<Id>('/api/v1/groups/:id', { config }, async (request) =>
    notes.renameGroup(
      owner(request),
      request.params.id,
      parse(updateGroupSchema, request.body).name,
    ),
  );

  app.post<Id>('/api/v1/groups/:id/move', { config }, async (request) =>
    notes.moveGroup(owner(request), request.params.id, parse(moveGroupSchema, request.body)),
  );

  app.delete<Id>('/api/v1/groups/:id', { config }, async (request) =>
    notes.deleteGroup(owner(request), request.params.id),
  );

  // Sections

  app.post('/api/v1/sections', { config }, async (request, reply) => {
    const body = parse(createSectionSchema, request.body);
    return reply.code(201).send(notes.createSection(owner(request), body));
  });

  app.patch<Id>('/api/v1/sections/:id', { config }, async (request) =>
    notes.updateSection(
      owner(request),
      request.params.id,
      parse(updateSectionSchema, request.body),
    ),
  );

  app.post<Id>('/api/v1/sections/:id/move', { config }, async (request) =>
    notes.moveSection(owner(request), request.params.id, parse(moveSectionSchema, request.body)),
  );

  app.delete<Id>('/api/v1/sections/:id', { config }, async (request) =>
    notes.deleteSection(owner(request), request.params.id),
  );

  // Pages

  app.post('/api/v1/pages', { config }, async (request, reply) => {
    const body = parse(createPageSchema, request.body);
    return reply.code(201).send(notes.createPage(owner(request), body));
  });

  app.get<Id>('/api/v1/pages/:id', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return notes.getPage(owner(request), request.params.id);
  });

  app.patch<Id>('/api/v1/pages/:id', { config }, async (request) =>
    notes.updatePage(owner(request), request.params.id, parse(updatePageSchema, request.body)),
  );

  app.post('/api/v1/pages/move', { config }, async (request) =>
    notes.movePages(owner(request), parse(placePagesSchema, request.body)),
  );

  app.post('/api/v1/pages/copy', { config }, async (request, reply) => {
    const body = parse(placePagesSchema, request.body);
    return reply.code(201).send(notes.copyPages(owner(request), body));
  });

  app.post<Id>('/api/v1/pages/:id/duplicate', { config }, async (request, reply) =>
    reply.code(201).send(notes.duplicatePage(owner(request), request.params.id)),
  );

  app.post('/api/v1/pages/delete', { config }, async (request) =>
    notes.deletePages(owner(request), parse(deletePagesSchema, request.body).ids),
  );

  // Recycle bin (browsing and emptying it arrive in Phase 7)

  app.post('/api/v1/trash/restore', { config }, async (request) =>
    notes.restore(owner(request), parse(restoreSchema, request.body).items),
  );

  // Settings

  const MAX_LAST_PAGES = 1000;

  const readUi = (userId: string): UiState => {
    const stored = uiStateSchema.safeParse(repos.settings.get(userId, 'ui') ?? {});
    return stored.success ? stored.data : {};
  };

  app.get('/api/v1/settings', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { ui: readUi(owner(request)) } satisfies Settings;
  });

  /** Merges the given fields into the stored ones; `lastPages` merges per section. */
  app.patch('/api/v1/settings', { config }, async (request) => {
    const userId = owner(request);
    const { ui: patch } = parse(updateSettingsSchema, request.body);
    const current = readUi(userId);
    const ui: UiState = { ...current, ...patch };
    if (patch.lastPages) {
      // Most recent last; the oldest sections drop out beyond the limit.
      const merged = Object.entries(current.lastPages ?? {}).filter(
        ([k]) => !(k in patch.lastPages!),
      );
      ui.lastPages = Object.fromEntries(
        [...merged, ...Object.entries(patch.lastPages)].slice(-MAX_LAST_PAGES),
      );
    }
    repos.settings.set(userId, 'ui', ui);
    return { ui } satisfies Settings;
  });
}
