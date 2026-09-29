import type { SectionColorId } from '../theme/sections';

/*
 * Placeholder boards until Kanban arrives (Phase 10). Notes come from the API.
 */

export interface DemoBoard {
  id: string;
  name: string;
}

export interface DemoProject {
  id: string;
  name: string;
  color: SectionColorId;
  boards: DemoBoard[];
}

export const PROJECTS: DemoProject[] = [
  {
    id: 'web',
    name: 'Website',
    color: 'cyan',
    boards: [
      { id: 'relaunch', name: 'Website relaunch' },
      { id: 'content', name: 'Content calendar' },
    ],
  },
  {
    id: 'garden-app',
    name: 'Garden app',
    color: 'green',
    boards: [{ id: 'sprint', name: 'Sprint board' }],
  },
];
