import {
  keysBetween,
  uuidv7,
  type Board,
  type BoardData,
  type Card,
  type CardDetail,
  type Column,
  type CreateBoardRequest,
  type CreateCardRequest,
  type CreateProjectRequest,
  type Label,
  type LinkedCard,
  type MoveCardRequest,
  type Project,
  type Projects,
  type ServerEvent,
  type UpdateBoardRequest,
  type UpdateCardRequest,
  type UpdateChecklistItemRequest,
  type UpdateColumnRequest,
  type UpdateLaneRequest,
  type UpdateProjectRequest,
} from '@memora/shared';
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { toast } from '../components/ui/toast-store';
import { api, errorMessage } from '../lib/api';

/*
 * Kanban's server state (§9.11): the projects for the navigation, one query per board and per
 * open card. Changes show at once (optimistic) and are put back, with a message, when the
 * server refuses them; other browsers' changes arrive as events and reload what they touch.
 */

export const kanbanKey = ['kanban'] as const;
export const projectsKey = ['kanban', 'projects'] as const;
export const boardKey = (id: string, archived = false) =>
  archived ? (['kanban', 'board', id, 'archived'] as const) : (['kanban', 'board', id] as const);
export const cardKey = (id: string) => ['kanban', 'card', id] as const;
export const pageCardsKey = (pageId: string) => ['kanban', 'page-cards', pageId] as const;

export const projectsQuery = queryOptions({
  queryKey: projectsKey,
  queryFn: () => api<Projects>('GET', '/projects'),
  staleTime: 30_000,
});

export const boardQuery = (id: string, archived = false) =>
  queryOptions({
    queryKey: boardKey(id, archived),
    queryFn: () => api<BoardData>('GET', `/boards/${id}${archived ? '?archived=1' : ''}`),
    staleTime: 10_000,
  });

export const cardQuery = (id: string) =>
  queryOptions({
    queryKey: cardKey(id),
    queryFn: () => api<CardDetail>('GET', `/cards/${id}`),
  });

export const pageCardsQuery = (pageId: string) =>
  queryOptions({
    queryKey: pageCardsKey(pageId),
    queryFn: () =>
      api<{ cards: LinkedCard[] }>('GET', `/pages/${pageId}/cards`).then((r) => r.cards),
  });

/** An event from the server (another browser, or this one's other tabs). */
export function kanbanEvent(queryClient: QueryClient, event: ServerEvent): void {
  if (event.type === 'projects.changed') {
    void queryClient.invalidateQueries({ queryKey: kanbanKey });
  } else if (event.type === 'board.changed') {
    void queryClient.invalidateQueries({ queryKey: ['kanban', 'board', event.boardId] });
    if (event.cardId) void queryClient.invalidateQueries({ queryKey: cardKey(event.cardId) });
    void queryClient.invalidateQueries({ queryKey: ['kanban', 'page-cards'] });
  }
}

/** Changes a board's data here first, then on the server; puts it back if that fails. */
async function optimistic<T>(
  queryClient: QueryClient,
  boardId: string,
  change: (board: BoardData) => BoardData,
  request: () => Promise<T>,
): Promise<T> {
  const key = boardKey(boardId);
  await queryClient.cancelQueries({ queryKey: key });
  const before = queryClient.getQueryData<BoardData>(key);
  if (before) queryClient.setQueryData(key, change(before));
  try {
    return await request();
  } catch (error) {
    if (before) queryClient.setQueryData(key, before);
    toast({ title: errorMessage(error), tone: 'error' });
    throw error;
  } finally {
    void queryClient.invalidateQueries({ queryKey: ['kanban', 'board', boardId] });
  }
}

const withCard = (board: BoardData, card: Card): BoardData => ({
  ...board,
  cards: board.cards.some((c) => c.id === card.id)
    ? board.cards.map((c) => (c.id === card.id ? card : c))
    : [...board.cards, card],
});

// Projects and boards

export async function createProject(queryClient: QueryClient, body: CreateProjectRequest) {
  const made = await api<{ project: Project; board: Board }>('POST', '/projects', body);
  await queryClient.invalidateQueries({ queryKey: projectsKey });
  return made;
}

export async function updateProject(
  queryClient: QueryClient,
  id: string,
  body: UpdateProjectRequest,
) {
  const project = await api<Project>('PATCH', `/projects/${id}`, body);
  await queryClient.invalidateQueries({ queryKey: kanbanKey });
  return project;
}

export async function deleteProject(queryClient: QueryClient, id: string) {
  await api('DELETE', `/projects/${id}`);
  await queryClient.invalidateQueries({ queryKey: projectsKey });
}

export async function createBoard(queryClient: QueryClient, body: CreateBoardRequest) {
  const board = await api<Board>('POST', '/boards', body);
  await queryClient.invalidateQueries({ queryKey: projectsKey });
  return board;
}

export async function updateBoard(queryClient: QueryClient, id: string, body: UpdateBoardRequest) {
  const board = await api<Board>('PATCH', `/boards/${id}`, body);
  await queryClient.invalidateQueries({ queryKey: projectsKey });
  await queryClient.invalidateQueries({ queryKey: ['kanban', 'board', id] });
  return board;
}

export async function deleteBoard(queryClient: QueryClient, id: string) {
  await api('DELETE', `/boards/${id}`);
  await queryClient.invalidateQueries({ queryKey: projectsKey });
}

export async function saveLabel(
  queryClient: QueryClient,
  projectId: string,
  label: { id?: string; name: string; color: Label['color'] },
) {
  const saved = label.id
    ? await api<Label>('PATCH', `/labels/${label.id}`, { name: label.name, color: label.color })
    : await api<Label>('POST', `/projects/${projectId}/labels`, {
        name: label.name,
        color: label.color,
      });
  await queryClient.invalidateQueries({ queryKey: kanbanKey });
  return saved;
}

export async function deleteLabel(queryClient: QueryClient, id: string) {
  await api('DELETE', `/labels/${id}`);
  await queryClient.invalidateQueries({ queryKey: kanbanKey });
}

// Columns and lanes

export async function createColumn(queryClient: QueryClient, boardId: string, name: string) {
  const column = await api<Column>('POST', `/boards/${boardId}/columns`, { name });
  await queryClient.invalidateQueries({ queryKey: ['kanban', 'board', boardId] });
  return column;
}

export function updateColumn(queryClient: QueryClient, column: Column, body: UpdateColumnRequest) {
  return optimistic(
    queryClient,
    column.boardId,
    (board) => {
      let columns = board.columns.map((c) => {
        if (c.id !== column.id) return c;
        const { archived, beforeId: _, ...rest } = body;
        return {
          ...c,
          ...rest,
          ...(archived === undefined ? {} : { archivedAt: archived ? Date.now() : null }),
        } as Column;
      });
      if (body.beforeId !== undefined) {
        const rest = columns.filter((c) => c.id !== column.id);
        const at = body.beforeId ? rest.findIndex((c) => c.id === body.beforeId) : rest.length;
        const before = rest[at - 1]?.sortKey ?? null;
        const after = rest[at]?.sortKey ?? null;
        const sortKey = keysBetween(before, after, 1)[0]!;
        columns = columns
          .map((c) => (c.id === column.id ? { ...c, sortKey } : c))
          .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
      }
      return { ...board, columns };
    },
    () => api<Column>('PATCH', `/columns/${column.id}`, body),
  );
}

export function deleteColumn(queryClient: QueryClient, column: Column) {
  return optimistic(
    queryClient,
    column.boardId,
    (board) => ({
      ...board,
      columns: board.columns.filter((c) => c.id !== column.id),
      cards: board.cards.filter((c) => c.columnId !== column.id),
    }),
    () => api('DELETE', `/columns/${column.id}`),
  );
}

export async function createLane(queryClient: QueryClient, boardId: string, name: string) {
  await api('POST', `/boards/${boardId}/lanes`, { name });
  await queryClient.invalidateQueries({ queryKey: ['kanban', 'board', boardId] });
}

export function updateLane(
  queryClient: QueryClient,
  boardId: string,
  laneId: string,
  body: UpdateLaneRequest,
) {
  return optimistic(
    queryClient,
    boardId,
    (board) => {
      const { beforeId: _, ...rest } = body;
      let swimlanes = board.swimlanes.map((l) => (l.id === laneId ? { ...l, ...rest } : l));
      if (body.beforeId !== undefined) {
        const others = swimlanes.filter((l) => l.id !== laneId);
        const at = body.beforeId ? others.findIndex((l) => l.id === body.beforeId) : others.length;
        const sortKey = keysBetween(
          others[at - 1]?.sortKey ?? null,
          others[at]?.sortKey ?? null,
          1,
        )[0]!;
        swimlanes = swimlanes
          .map((l) => (l.id === laneId ? { ...l, sortKey } : l))
          .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
      }
      return { ...board, swimlanes };
    },
    () => api('PATCH', `/lanes/${laneId}`, body),
  );
}

export function deleteLane(queryClient: QueryClient, boardId: string, laneId: string) {
  return optimistic(
    queryClient,
    boardId,
    (board) => ({
      ...board,
      swimlanes: board.swimlanes.filter((l) => l.id !== laneId),
      cards: board.cards.map((c) => (c.swimlaneId === laneId ? { ...c, swimlaneId: null } : c)),
    }),
    () => api('DELETE', `/lanes/${laneId}`),
  );
}

// Cards

/** The sort key a card gets before `beforeId` in its column (or last, or first). */
export function cardSortKey(
  board: BoardData,
  columnId: string,
  beforeId: string | null,
  top = false,
  self?: string,
): string {
  const list = board.cards
    .filter((c) => c.columnId === columnId && c.id !== self)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
  const at = top ? 0 : beforeId ? list.findIndex((c) => c.id === beforeId) : list.length;
  const index = at < 0 ? list.length : at;
  return keysBetween(list[index - 1]?.sortKey ?? null, list[index]?.sortKey ?? null, 1)[0]!;
}

export function createCard(queryClient: QueryClient, boardId: string, body: CreateCardRequest) {
  const id = body.id ?? uuidv7();
  const now = Date.now();
  return optimistic(
    queryClient,
    boardId,
    (board) => {
      const column = board.columns.find((c) => c.id === body.columnId);
      const card: Card = {
        id,
        boardId,
        columnId: body.columnId,
        swimlaneId: body.swimlaneId ?? null,
        number: 0,
        title: body.title.trim(),
        priority: 'none',
        startDate: null,
        dueDate: null,
        coverColor: null,
        labelIds: [],
        checklist: { done: 0, total: 0 },
        comments: 0,
        attachments: 0,
        pages: body.pageId ? 1 : 0,
        sortKey: cardSortKey(board, body.columnId, body.beforeId ?? null, body.top),
        completedAt: column?.isDone ? now : null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      return withCard(board, card);
    },
    () => api<Card>('POST', '/cards', { ...body, id }),
  );
}

export function updateCard(queryClient: QueryClient, card: Card, body: UpdateCardRequest) {
  return optimistic(
    queryClient,
    card.boardId,
    (board) => {
      const { completed, archived, description: _, ...rest } = body;
      const next: Card = {
        ...card,
        ...rest,
        ...(completed === undefined ? {} : { completedAt: completed ? Date.now() : null }),
        ...(archived === undefined ? {} : { archivedAt: archived ? Date.now() : null }),
      } as Card;
      return archived
        ? { ...board, cards: board.cards.filter((c) => c.id !== card.id) }
        : withCard(board, next);
    },
    async () => {
      const saved = await api<Card>('PATCH', `/cards/${card.id}`, body);
      void queryClient.invalidateQueries({ queryKey: cardKey(card.id) });
      void queryClient.invalidateQueries({
        queryKey: ['kanban', 'board', card.boardId, 'archived'],
      });
      return saved;
    },
  );
}

export interface MoveTarget extends MoveCardRequest {
  /** Changed with the move: a lane of automatic lanes sets priority or labels. */
  patch?: UpdateCardRequest;
}

/** How to move a card back from a move to `target`, as the board has it now. */
export function moveBack(queryClient: QueryClient, card: Card, target: MoveTarget): MoveTarget {
  const board = queryClient.getQueryData<BoardData>(boardKey(card.boardId));
  return {
    columnId: card.columnId,
    swimlaneId: card.swimlaneId,
    beforeId: board ? nextCard(board, card) : null,
    ...(target.patch
      ? {
          patch: {
            ...(target.patch.priority ? { priority: card.priority } : {}),
            ...(target.patch.labelIds ? { labelIds: card.labelIds } : {}),
          },
        }
      : {}),
  };
}

/** Moves a card on its board (or away from it), answering how to move it back. */
export async function moveCard(
  queryClient: QueryClient,
  card: Card,
  target: MoveTarget,
): Promise<MoveTarget> {
  const back = moveBack(queryClient, card, target);
  const moved = await optimistic(
    queryClient,
    card.boardId,
    (data) => {
      const column = data.columns.find((c) => c.id === target.columnId);
      if (!column) return { ...data, cards: data.cards.filter((c) => c.id !== card.id) };
      const from = data.columns.find((c) => c.id === card.columnId);
      let completedAt = card.completedAt;
      if (column.isDone && !from?.isDone) completedAt ??= Date.now();
      if (!column.isDone && from?.isDone) completedAt = null;
      return withCard(data, {
        ...card,
        ...(target.patch as Partial<Card> | undefined),
        columnId: target.columnId,
        swimlaneId: target.swimlaneId ?? null,
        completedAt,
        sortKey: cardSortKey(data, target.columnId, target.beforeId ?? null, false, card.id),
      });
    },
    async () => {
      if (target.patch && Object.keys(target.patch).length) {
        await api('PATCH', `/cards/${card.id}`, target.patch);
      }
      return api<Card>('POST', `/cards/${card.id}/move`, {
        columnId: target.columnId,
        swimlaneId: target.swimlaneId ?? null,
        beforeId: target.beforeId ?? null,
      });
    },
  );
  void queryClient.invalidateQueries({ queryKey: cardKey(card.id) });
  // To another board: that board's copy here is out of date (the server tells only the others).
  if (moved.boardId !== card.boardId) {
    void queryClient.invalidateQueries({ queryKey: ['kanban', 'board', moved.boardId] });
  }
  return back;
}

/** The card after `card` in its column, to move it back before. */
function nextCard(board: BoardData, card: Card): string | null {
  const list = board.cards
    .filter((c) => c.columnId === card.columnId)
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
  return list[list.findIndex((c) => c.id === card.id) + 1]?.id ?? null;
}

export async function duplicateCard(queryClient: QueryClient, card: Card) {
  const copy = await api<Card>('POST', `/cards/${card.id}/duplicate`);
  await queryClient.invalidateQueries({ queryKey: ['kanban', 'board', card.boardId] });
  return copy;
}

export function deleteCard(queryClient: QueryClient, card: Card) {
  return optimistic(
    queryClient,
    card.boardId,
    (board) => ({ ...board, cards: board.cards.filter((c) => c.id !== card.id) }),
    () => api('DELETE', `/cards/${card.id}`),
  );
}

// What a card holds: each call answers the card as it is now.

async function cardCall(
  queryClient: QueryClient,
  cardId: string,
  boardId: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<CardDetail> {
  try {
    const detail = await api<CardDetail>(method, path, body);
    queryClient.setQueryData(cardKey(cardId), detail);
    queryClient.setQueryData<BoardData>(boardKey(boardId), (board) =>
      board ? withCard(board, detail.card) : board,
    );
    void queryClient.invalidateQueries({ queryKey: ['kanban', 'page-cards'] });
    return detail;
  } catch (error) {
    toast({ title: errorMessage(error), tone: 'error' });
    throw error;
  }
}

export const cardActions = (queryClient: QueryClient, card: Pick<Card, 'id' | 'boardId'>) => {
  const call = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) =>
    cardCall(queryClient, card.id, card.boardId, method, path, body);
  return {
    addChecklist: (title: string) => call('POST', `/cards/${card.id}/checklists`, { title }),
    renameChecklist: (id: string, title: string) => call('PATCH', `/checklists/${id}`, { title }),
    deleteChecklist: (id: string) => call('DELETE', `/checklists/${id}`),
    addItem: (checklistId: string, text: string) =>
      call('POST', `/checklists/${checklistId}/items`, { text }),
    updateItem: (id: string, body: UpdateChecklistItemRequest) =>
      call('PATCH', `/checklist-items/${id}`, body),
    deleteItem: (id: string) => call('DELETE', `/checklist-items/${id}`),
    addComment: (body: string) => call('POST', `/cards/${card.id}/comments`, { body }),
    editComment: (id: string, body: string) => call('PATCH', `/comments/${id}`, { body }),
    deleteComment: (id: string) => call('DELETE', `/comments/${id}`),
    linkPage: (pageId: string) => call('PUT', `/cards/${card.id}/pages/${pageId}`),
    unlinkPage: (pageId: string) => call('DELETE', `/cards/${card.id}/pages/${pageId}`),
    attach: (assetId: string) => call('POST', `/cards/${card.id}/attachments`, { assetId }),
    detach: (assetId: string) => call('DELETE', `/cards/${card.id}/attachments/${assetId}`),
  };
};

/** Finds a card by its key (`WEB-42`). */
export const cardByKey = (key: string) =>
  api<{ id: string; boardId: string }>('GET', `/cards/by-key/${encodeURIComponent(key)}`);
