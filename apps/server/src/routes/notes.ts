import {
  createGroupSchema,
  createNotebookSchema,
  MAX_CONTENT,
  convertPageSchema,
  createPageSchema,
  createSectionSchema,
  createVersionSchema,
  deleteForeverSchema,
  nameVersionSchema,
  restoreToSchema,
  deletePagesSchema,
  editorSettingsSchema,
  moveGroupSchema,
  moveNotebookSchema,
  moveSectionSchema,
  placePagesSchema,
  restoreSchema,
  saveContentSchema,
  uiStateSchema,
  updateGroupSchema,
  updateNotebookSchema,
  updatePageSchema,
  updateSectionSchema,
  updateSettingsSchema,
  type EditorSettings,
  type Settings,
  type UiState,
} from '@memora/shared';
import type { FastifyInstance } from 'fastify';
import { cleanUnusedAssets } from '../assets/cleanup';
import { parse } from '../errors';
import { authOf, type RouteDeps } from './auth';
import { deviceOf } from './events';

type Id = { Params: { id: string } };

/** Notebooks, section groups, sections, pages, the recycle bin and per-user settings. */
export function notesRoutes(
  app: FastifyInstance,
  { notes, repos, events, db, now, config: settings }: RouteDeps,
): void {
  const { trashMs } = settings;
  const config = { access: 'user' as const };
  /** Routes that change the tree: the user's other browsers hear about it (§9.6). */
  const changes = { access: 'user' as const, emits: 'tree' as const };
  const owner = (request: Parameters<typeof authOf>[0]) => authOf(request).user.id;

  app.get('/api/v1/tree', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return notes.tree(owner(request));
  });

  // Notebooks

  app.post('/api/v1/notebooks', { config: changes }, async (request, reply) => {
    const body = parse(createNotebookSchema, request.body);
    return reply.code(201).send(notes.createNotebook(owner(request), body));
  });

  app.patch<Id>('/api/v1/notebooks/:id', { config: changes }, async (request) =>
    notes.updateNotebook(
      owner(request),
      request.params.id,
      parse(updateNotebookSchema, request.body),
    ),
  );

  app.post<Id>('/api/v1/notebooks/:id/move', { config: changes }, async (request) =>
    notes.moveNotebook(
      owner(request),
      request.params.id,
      parse(moveNotebookSchema, request.body).beforeId,
    ),
  );

  app.delete<Id>('/api/v1/notebooks/:id', { config: changes }, async (request) =>
    notes.deleteNotebook(owner(request), request.params.id),
  );

  // Section groups

  app.post('/api/v1/groups', { config: changes }, async (request, reply) => {
    const body = parse(createGroupSchema, request.body);
    return reply.code(201).send(notes.createGroup(owner(request), body));
  });

  app.patch<Id>('/api/v1/groups/:id', { config: changes }, async (request) =>
    notes.renameGroup(
      owner(request),
      request.params.id,
      parse(updateGroupSchema, request.body).name,
    ),
  );

  app.post<Id>('/api/v1/groups/:id/move', { config: changes }, async (request) =>
    notes.moveGroup(owner(request), request.params.id, parse(moveGroupSchema, request.body)),
  );

  app.delete<Id>('/api/v1/groups/:id', { config: changes }, async (request) =>
    notes.deleteGroup(owner(request), request.params.id),
  );

  // Sections

  app.post('/api/v1/sections', { config: changes }, async (request, reply) => {
    const body = parse(createSectionSchema, request.body);
    return reply.code(201).send(notes.createSection(owner(request), body));
  });

  app.patch<Id>('/api/v1/sections/:id', { config: changes }, async (request) =>
    notes.updateSection(
      owner(request),
      request.params.id,
      parse(updateSectionSchema, request.body),
    ),
  );

  app.post<Id>('/api/v1/sections/:id/move', { config: changes }, async (request) =>
    notes.moveSection(owner(request), request.params.id, parse(moveSectionSchema, request.body)),
  );

  app.delete<Id>('/api/v1/sections/:id', { config: changes }, async (request) =>
    notes.deleteSection(owner(request), request.params.id),
  );

  // Pages

  app.post('/api/v1/pages', { config: changes }, async (request, reply) => {
    const body = parse(createPageSchema, request.body);
    return reply.code(201).send(notes.createPage(owner(request), body));
  });

  app.get<Id>('/api/v1/pages/:id', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return notes.getPage(owner(request), request.params.id);
  });

  // A new title is written into the links to the page: those pages changed too.
  app.patch<Id>('/api/v1/pages/:id', { config: changes }, async (request) => {
    const { user, session } = authOf(request);
    const body = parse(updatePageSchema, request.body);
    const result = notes.updatePage(user.id, request.params.id, body, session.deviceLabel);
    for (const page of result.pages?.slice(1) ?? []) {
      events.publish(user.id, {
        type: 'page.updated',
        page,
        revision: page.revision,
        origin: null,
      });
    }
    return result;
  });

  // Content (§9.6): JSON-escaped text can be several bytes per character.
  app.put<Id>(
    '/api/v1/pages/:id/content',
    { config, bodyLimit: MAX_CONTENT * 4 },
    async (request) => {
      const { user, session } = authOf(request);
      const body = parse(saveContentSchema, request.body);
      const saved = notes.saveContent(user.id, request.params.id, body, session.deviceLabel);
      if (saved.revision !== body.baseRevision) {
        events.publish(user.id, {
          type: 'page.updated',
          page: saved.pages[0],
          revision: saved.revision,
          origin: deviceOf(request),
        });
      }
      return saved;
    },
  );

  // Conversion (§9.4): other browsers take the page's new type and content from the event.
  app.post<Id>(
    '/api/v1/pages/:id/convert',
    { config, bodyLimit: MAX_CONTENT * 4 },
    async (request) => {
      const { user, session } = authOf(request);
      const body = parse(convertPageSchema, request.body);
      const saved = notes.convertPage(user.id, request.params.id, body, session.deviceLabel);
      events.publish(user.id, {
        type: 'page.updated',
        page: saved.pages[0],
        revision: saved.revision,
        origin: deviceOf(request),
      });
      return saved;
    },
  );

  // History (§9.7)

  type Version = { Params: { id: string; vid: string } };

  app.get<Id>('/api/v1/pages/:id/versions', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return notes.listVersions(owner(request), request.params.id);
  });

  app.post<Id>(
    '/api/v1/pages/:id/versions',
    { config, bodyLimit: MAX_CONTENT * 4 },
    async (request, reply) => {
      const { user, session } = authOf(request);
      const body = parse(createVersionSchema, request.body);
      const kept = notes.createVersion(user.id, request.params.id, body, session.deviceLabel);
      return reply.code(kept.version ? 201 : 200).send(kept);
    },
  );

  app.get<Version>('/api/v1/pages/:id/versions/:vid', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return notes.getVersion(owner(request), request.params.id, request.params.vid);
  });

  app.patch<Version>('/api/v1/pages/:id/versions/:vid', { config }, async (request) =>
    notes.nameVersion(
      owner(request),
      request.params.id,
      request.params.vid,
      parse(nameVersionSchema, request.body),
    ),
  );

  app.post<Version>('/api/v1/pages/:id/versions/:vid/restore', { config }, async (request) => {
    const { user, session } = authOf(request);
    const saved = notes.restoreVersion(
      user.id,
      request.params.id,
      request.params.vid,
      session.deviceLabel,
    );
    events.publish(user.id, {
      type: 'page.updated',
      page: saved.pages[0],
      revision: saved.revision,
      origin: deviceOf(request),
    });
    return saved;
  });

  app.post<Version>(
    '/api/v1/pages/:id/versions/:vid/copy',
    { config: changes },
    async (request, reply) =>
      reply
        .code(201)
        .send(notes.copyVersion(owner(request), request.params.id, request.params.vid)),
  );

  app.post('/api/v1/pages/move', { config: changes }, async (request) =>
    notes.movePages(owner(request), parse(placePagesSchema, request.body)),
  );

  app.post('/api/v1/pages/copy', { config: changes }, async (request, reply) => {
    const body = parse(placePagesSchema, request.body);
    return reply.code(201).send(notes.copyPages(owner(request), body));
  });

  app.post<Id>('/api/v1/pages/:id/duplicate', { config: changes }, async (request, reply) =>
    reply.code(201).send(notes.duplicatePage(owner(request), request.params.id)),
  );

  app.post('/api/v1/pages/delete', { config: changes }, async (request) =>
    notes.deletePages(owner(request), parse(deletePagesSchema, request.body).ids),
  );

  // Recycle bin (§9.7)

  app.get('/api/v1/trash', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return notes.listTrash(owner(request), trashMs);
  });

  app.post('/api/v1/trash/restore', { config: changes }, async (request) =>
    notes.restore(owner(request), parse(restoreSchema, request.body).items),
  );

  app.post('/api/v1/trash/restore-to', { config: changes }, async (request) =>
    notes.restoreTo(owner(request), parse(restoreToSchema, request.body)),
  );

  app.post('/api/v1/trash/delete', { config }, async (request) => {
    const user = owner(request);
    const result = notes.deleteForever(user, parse(deleteForeverSchema, request.body).items);
    cleanUnusedAssets(db, now(), [user]);
    return result;
  });

  app.post('/api/v1/trash/empty', { config }, async (request) => {
    const user = owner(request);
    const result = notes.emptyTrash(user);
    cleanUnusedAssets(db, now(), [user]);
    return result;
  });

  // Settings

  const MAX_LAST_PAGES = 1000;
  const MAX_PAGE_WIDTHS = 1000;

  const readUi = (userId: string): UiState => {
    const stored = uiStateSchema.safeParse(repos.settings.get(userId, 'ui') ?? {});
    return stored.success ? stored.data : {};
  };

  const readEditor = (userId: string): EditorSettings => {
    const stored = editorSettingsSchema.safeParse(repos.settings.get(userId, 'editor') ?? {});
    return stored.success ? stored.data : {};
  };

  app.get('/api/v1/settings', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const userId = owner(request);
    return { ui: readUi(userId), editor: readEditor(userId) } satisfies Settings;
  });

  /**
   * Merges the given fields into the stored ones; `lastPages` and `sectionTemplates` merge per
   * section (a null template removes the section's), and `pageWidths` per page (null too).
   */
  app.patch('/api/v1/settings', { config }, async (request) => {
    const userId = owner(request);
    const body = parse(updateSettingsSchema, request.body);
    let ui = readUi(userId);
    if (body.ui) {
      const patch = body.ui;
      const current = ui;
      ui = { ...current, ...patch };
      if (patch.lastPages) {
        // Most recent last; the oldest sections drop out beyond the limit.
        const merged = Object.entries(current.lastPages ?? {}).filter(
          ([k]) => !(k in patch.lastPages!),
        );
        ui.lastPages = Object.fromEntries(
          [...merged, ...Object.entries(patch.lastPages)].slice(-MAX_LAST_PAGES),
        );
      }
      if (patch.sectionTemplates) {
        const merged = { ...current.sectionTemplates, ...patch.sectionTemplates };
        ui.sectionTemplates = Object.fromEntries(
          Object.entries(merged).filter(([, template]) => template !== null),
        );
      }
      if (patch.pageWidths) {
        // Most recent last; the oldest pages drop out beyond the limit.
        const kept = Object.entries(current.pageWidths ?? {}).filter(
          ([k]) => !(k in patch.pageWidths!),
        );
        ui.pageWidths = Object.fromEntries(
          [...kept, ...Object.entries(patch.pageWidths)]
            .filter(([, width]) => width !== null)
            .slice(-MAX_PAGE_WIDTHS),
        );
      }
      repos.settings.set(userId, 'ui', ui);
    }
    let editor = readEditor(userId);
    if (body.editor) {
      editor = { ...editor, ...body.editor };
      repos.settings.set(userId, 'editor', editor);
    }
    return { ui, editor } satisfies Settings;
  });
}
