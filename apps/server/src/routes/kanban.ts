import {
  attachSchema,
  commentSchema,
  createBoardSchema,
  createCardSchema,
  createChecklistItemSchema,
  createChecklistSchema,
  createColumnSchema,
  createLabelSchema,
  createLaneSchema,
  createProjectSchema,
  idSchema,
  moveCardSchema,
  updateBoardSchema,
  updateCardSchema,
  updateChecklistItemSchema,
  updateChecklistSchema,
  updateColumnSchema,
  updateLabelSchema,
  updateLaneSchema,
  updateProjectSchema,
} from '@memora/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parse } from '../errors';
import type { KanbanService } from '../kanban/service';
import { authOf, type RouteDeps } from './auth';
import { deviceOf } from './events';

type Id = { Params: { id: string } };
type Linked = { Params: { id: string; other: string } };

/**
 * Kanban (§9.11, §10): projects, boards, columns, swimlanes, cards and what cards hold. Every
 * change tells the user's other browsers: `projects.changed` for the navigation (projects,
 * boards, labels), `board.changed` for what is on a board.
 */
export function kanbanRoutes(
  app: FastifyInstance,
  deps: RouteDeps & { kanban: KanbanService },
): void {
  const { kanban, events } = deps;
  const config = { access: 'user' as const };
  const actor = (request: FastifyRequest) => {
    const { user } = authOf(request);
    return { owner: user.id, userId: user.id };
  };
  const owner = (request: FastifyRequest) => authOf(request).user.id;
  const id = (request: FastifyRequest<Id>) => parse(idSchema, request.params.id);
  const projectsChanged = (request: FastifyRequest) =>
    events.publish(owner(request), { type: 'projects.changed', origin: deviceOf(request) });
  const boardChanged = (request: FastifyRequest, boardId: string, cardId?: string) =>
    events.publish(owner(request), {
      type: 'board.changed',
      boardId,
      ...(cardId ? { cardId } : {}),
      origin: deviceOf(request),
    });

  // Projects and boards

  app.get('/api/v1/projects', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return kanban.projects(owner(request));
  });

  app.post('/api/v1/projects', { config }, async (request, reply) => {
    const made = kanban.createProject(owner(request), parse(createProjectSchema, request.body));
    projectsChanged(request);
    return reply.code(201).send(made);
  });

  app.patch<Id>('/api/v1/projects/:id', { config }, async (request) => {
    const project = kanban.updateProject(
      owner(request),
      id(request),
      parse(updateProjectSchema, request.body),
    );
    projectsChanged(request);
    return project;
  });

  app.delete<Id>('/api/v1/projects/:id', { config }, async (request, reply) => {
    kanban.deleteProject(owner(request), id(request));
    projectsChanged(request);
    return reply.code(204).send();
  });

  app.post<Id>('/api/v1/projects/:id/labels', { config }, async (request, reply) => {
    const label = kanban.createLabel(
      owner(request),
      id(request),
      parse(createLabelSchema, request.body),
    );
    projectsChanged(request);
    return reply.code(201).send(label);
  });

  app.patch<Id>('/api/v1/labels/:id', { config }, async (request) => {
    const label = kanban.updateLabel(
      owner(request),
      id(request),
      parse(updateLabelSchema, request.body),
    );
    projectsChanged(request);
    return label;
  });

  app.delete<Id>('/api/v1/labels/:id', { config }, async (request, reply) => {
    kanban.deleteLabel(owner(request), id(request));
    projectsChanged(request);
    return reply.code(204).send();
  });

  app.post('/api/v1/boards', { config }, async (request, reply) => {
    const board = kanban.createBoard(owner(request), parse(createBoardSchema, request.body));
    projectsChanged(request);
    return reply.code(201).send(board);
  });

  app.get<Id & { Querystring: { archived?: string } }>(
    '/api/v1/boards/:id',
    { config },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return kanban.board(owner(request), id(request), request.query.archived === '1');
    },
  );

  app.patch<Id>('/api/v1/boards/:id', { config }, async (request) => {
    const board = kanban.updateBoard(
      owner(request),
      id(request),
      parse(updateBoardSchema, request.body),
    );
    projectsChanged(request);
    boardChanged(request, board.id);
    return board;
  });

  app.delete<Id>('/api/v1/boards/:id', { config }, async (request, reply) => {
    kanban.deleteBoard(owner(request), id(request));
    projectsChanged(request);
    return reply.code(204).send();
  });

  // Columns and swimlanes

  app.post<Id>('/api/v1/boards/:id/columns', { config }, async (request, reply) => {
    const column = kanban.createColumn(
      owner(request),
      id(request),
      parse(createColumnSchema, request.body),
    );
    boardChanged(request, column.boardId);
    return reply.code(201).send(column);
  });

  app.patch<Id>('/api/v1/columns/:id', { config }, async (request) => {
    const column = kanban.updateColumn(
      owner(request),
      id(request),
      parse(updateColumnSchema, request.body),
    );
    boardChanged(request, column.boardId);
    return column;
  });

  app.delete<Id>('/api/v1/columns/:id', { config }, async (request, reply) => {
    const { boardId } = kanban.deleteColumn(owner(request), id(request));
    boardChanged(request, boardId);
    return reply.code(204).send();
  });

  app.post<Id>('/api/v1/boards/:id/lanes', { config }, async (request, reply) => {
    const lane = kanban.createLane(
      owner(request),
      id(request),
      parse(createLaneSchema, request.body),
    );
    boardChanged(request, lane.boardId);
    return reply.code(201).send(lane);
  });

  app.patch<Id>('/api/v1/lanes/:id', { config }, async (request, reply) => {
    const { boardId } = kanban.updateLane(
      owner(request),
      id(request),
      parse(updateLaneSchema, request.body),
    );
    boardChanged(request, boardId);
    return reply.code(204).send();
  });

  app.delete<Id>('/api/v1/lanes/:id', { config }, async (request, reply) => {
    const { boardId } = kanban.deleteLane(owner(request), id(request));
    boardChanged(request, boardId);
    return reply.code(204).send();
  });

  // Cards

  app.post('/api/v1/cards', { config }, async (request, reply) => {
    const card = kanban.createCard(actor(request), parse(createCardSchema, request.body));
    boardChanged(request, card.boardId, card.id);
    return reply.code(201).send(card);
  });

  app.get<{ Params: { key: string } }>('/api/v1/cards/by-key/:key', { config }, async (request) =>
    kanban.cardByKey(owner(request), request.params.key),
  );

  app.get<Id>('/api/v1/cards/:id', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return kanban.card(owner(request), id(request));
  });

  app.patch<Id>('/api/v1/cards/:id', { config }, async (request) => {
    const card = kanban.updateCard(
      actor(request),
      id(request),
      parse(updateCardSchema, request.body),
    );
    boardChanged(request, card.boardId, card.id);
    return card;
  });

  app.post<Id>('/api/v1/cards/:id/move', { config }, async (request) => {
    const { card, fromBoardId } = kanban.moveCard(
      actor(request),
      id(request),
      parse(moveCardSchema, request.body),
    );
    boardChanged(request, card.boardId, card.id);
    if (fromBoardId !== card.boardId) boardChanged(request, fromBoardId, card.id);
    return card;
  });

  app.post<Id>('/api/v1/cards/:id/duplicate', { config }, async (request, reply) => {
    const card = kanban.duplicateCard(actor(request), id(request));
    boardChanged(request, card.boardId, card.id);
    return reply.code(201).send(card);
  });

  app.delete<Id>('/api/v1/cards/:id', { config }, async (request, reply) => {
    const { boardId } = kanban.deleteCard(owner(request), id(request));
    boardChanged(request, boardId, request.params.id);
    return reply.code(204).send();
  });

  // What a card holds: each answers the card as it is now.

  const cardAfter = (request: FastifyRequest, boardId: string, cardId: string) => {
    boardChanged(request, boardId, cardId);
    return kanban.card(owner(request), cardId);
  };

  app.post<Id>('/api/v1/cards/:id/checklists', { config }, async (request, reply) => {
    const { title } = parse(createChecklistSchema, request.body);
    const { boardId } = kanban.addChecklist(actor(request), id(request), title);
    return reply.code(201).send(cardAfter(request, boardId, id(request)));
  });

  app.patch<Id>('/api/v1/checklists/:id', { config }, async (request) => {
    const { title } = parse(updateChecklistSchema, request.body);
    const { boardId, cardId } = kanban.renameChecklist(owner(request), id(request), title);
    return cardAfter(request, boardId, cardId);
  });

  app.delete<Id>('/api/v1/checklists/:id', { config }, async (request) => {
    const { boardId, cardId } = kanban.deleteChecklist(owner(request), id(request));
    return cardAfter(request, boardId, cardId);
  });

  app.post<Id>('/api/v1/checklists/:id/items', { config }, async (request, reply) => {
    const { text } = parse(createChecklistItemSchema, request.body);
    const { boardId, cardId } = kanban.addItem(owner(request), id(request), text);
    return reply.code(201).send(cardAfter(request, boardId, cardId));
  });

  app.patch<Id>('/api/v1/checklist-items/:id', { config }, async (request) => {
    const { boardId, cardId } = kanban.updateItem(
      owner(request),
      id(request),
      parse(updateChecklistItemSchema, request.body),
    );
    return cardAfter(request, boardId, cardId);
  });

  app.delete<Id>('/api/v1/checklist-items/:id', { config }, async (request) => {
    const { boardId, cardId } = kanban.deleteItem(owner(request), id(request));
    return cardAfter(request, boardId, cardId);
  });

  app.post<Id>('/api/v1/cards/:id/comments', { config }, async (request, reply) => {
    const { body } = parse(commentSchema, request.body);
    const { boardId } = kanban.addComment(actor(request), id(request), body);
    return reply.code(201).send(cardAfter(request, boardId, id(request)));
  });

  app.patch<Id>('/api/v1/comments/:id', { config }, async (request) => {
    const { body } = parse(commentSchema, request.body);
    const { boardId, cardId } = kanban.editComment(owner(request), id(request), body);
    return cardAfter(request, boardId, cardId);
  });

  app.delete<Id>('/api/v1/comments/:id', { config }, async (request) => {
    const { boardId, cardId } = kanban.deleteComment(owner(request), id(request));
    return cardAfter(request, boardId, cardId);
  });

  app.put<Linked>('/api/v1/cards/:id/pages/:other', { config }, async (request) => {
    const cardId = parse(idSchema, request.params.id);
    const { boardId } = kanban.linkPage(
      actor(request),
      cardId,
      parse(idSchema, request.params.other),
    );
    return cardAfter(request, boardId, cardId);
  });

  app.delete<Linked>('/api/v1/cards/:id/pages/:other', { config }, async (request) => {
    const cardId = parse(idSchema, request.params.id);
    const { boardId } = kanban.unlinkPage(
      actor(request),
      cardId,
      parse(idSchema, request.params.other),
    );
    return cardAfter(request, boardId, cardId);
  });

  app.get<Id>('/api/v1/pages/:id/cards', { config }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { cards: kanban.pageCards(owner(request), id(request)) };
  });

  app.post<Id>('/api/v1/cards/:id/attachments', { config }, async (request, reply) => {
    const { assetId } = parse(attachSchema, request.body);
    const { boardId } = kanban.attach(actor(request), id(request), assetId);
    return reply.code(201).send(cardAfter(request, boardId, id(request)));
  });

  app.delete<Linked>('/api/v1/cards/:id/attachments/:other', { config }, async (request) => {
    const cardId = parse(idSchema, request.params.id);
    const { boardId } = kanban.detach(
      owner(request),
      cardId,
      parse(idSchema, request.params.other),
    );
    return cardAfter(request, boardId, cardId);
  });
}
