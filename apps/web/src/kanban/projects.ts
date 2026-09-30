import type { Projects } from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import type { useGo } from '../shell/location';
import { useShell } from '../shell/store';
import { projectsQuery } from './api';

/* The user's projects and boards, for the navigation and the "Boards" buttons. */

const EMPTY: Projects = { projects: [], boards: [], labels: [] };

export function useProjects(): Projects {
  return useQuery(projectsQuery).data ?? EMPTY;
}

/** The board to open for "Boards": the first one that isn't archived. */
export function firstBoardId(data: Projects): string | null {
  for (const project of data.projects) {
    if (project.archivedAt) continue;
    const board = data.boards.find((b) => b.projectId === project.id && !b.archivedAt);
    if (board) return board.id;
  }
  return null;
}

/** Opens the first board, or starts a first project. */
export function openBoards(data: Projects, go: ReturnType<typeof useGo>): void {
  const id = firstBoardId(data);
  if (id) go.board(id);
  else useShell.getState().openDialog({ kind: 'new-project' });
}
