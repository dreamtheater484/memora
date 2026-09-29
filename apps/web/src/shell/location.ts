import type { Notebook, PageMeta, Section, SectionGroup, UiState } from '@memora/shared';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMemo } from 'react';
import type { NotesIndex, SectionPath } from '../notes/model';
import { useNotes, useUiState } from '../notes/queries';

/*
 * Where you are comes from the URL: /p/<page>, /s/<section>, /g/<group>, /n/<notebook>,
 * /b/<board>, or / for home. Phones show exactly that level (drill-down navigation); larger
 * screens always show a section and a page, the last one you had open there.
 */

export type Level = 'home' | 'notebook' | 'group' | 'section' | 'page' | 'board';

export interface Current {
  index: NotesIndex;
  level: Level;
  /** The id in the URL was not found (deleted, or never existed). */
  missing: boolean;
  notebook: Notebook | null;
  /** The group named in the URL, at the group level. */
  group: SectionGroup | null;
  section: Section | null;
  path: SectionPath | null;
  page: PageMeta | null;
  boardId: string | null;
}

interface Params {
  notebookId?: string;
  groupId?: string;
  sectionId?: string;
  pageId?: string;
  boardId?: string;
}

/** The first section in reading order: the notebook's own sections, then each group's. */
function firstSection(index: NotesIndex, notebookId: string, groupId: string | null = null) {
  return index.allSectionsOf(notebookId, groupId)[0] ?? null;
}

function lastPageOf(index: NotesIndex, ui: UiState, sectionId: string): PageMeta | null {
  const remembered = ui.lastPages?.[sectionId];
  const page = remembered ? index.page.get(remembered) : undefined;
  if (page && page.sectionId === sectionId) return page;
  return index.pagesOf(sectionId)[0]?.page ?? null;
}

export function resolveCurrent(index: NotesIndex, ui: UiState, params: Params): Current {
  const base = {
    index,
    missing: false,
    notebook: null,
    group: null,
    section: null,
    path: null,
    page: null,
    boardId: null,
  };
  const withSection = (level: Level, section: Section | null, page?: PageMeta | null): Current => {
    const path = section ? index.pathOf(section.id) : null;
    return {
      ...base,
      level,
      notebook: path?.notebook ?? null,
      section,
      path,
      page: page === undefined ? (section ? lastPageOf(index, ui, section.id) : null) : page,
    };
  };
  const remembered = ui.lastSectionId ? index.section.get(ui.lastSectionId) : undefined;

  if (params.boardId) return { ...base, level: 'board', boardId: params.boardId };
  if (params.pageId) {
    const page = index.page.get(params.pageId) ?? null;
    if (!page) return { ...withSection('page', null, null), missing: true };
    return withSection('page', index.section.get(page.sectionId) ?? null, page);
  }
  if (params.sectionId) {
    const section = index.section.get(params.sectionId) ?? null;
    return { ...withSection('section', section), missing: !section };
  }
  if (params.groupId) {
    const group = index.group.get(params.groupId) ?? null;
    if (!group) return { ...withSection('group', null, null), missing: true };
    const inGroup =
      remembered && index.pathOf(remembered.id)?.groups.some((g) => g.id === group.id);
    const section = inGroup ? remembered : firstSection(index, group.notebookId, group.id);
    return {
      ...withSection('group', section ?? null),
      group,
      notebook: index.notebook.get(group.notebookId) ?? null,
    };
  }
  if (params.notebookId) {
    const notebook = index.notebook.get(params.notebookId) ?? null;
    if (!notebook) return { ...withSection('notebook', null, null), missing: true };
    const section =
      remembered?.notebookId === notebook.id ? remembered : firstSection(index, notebook.id);
    return { ...withSection('notebook', section), notebook };
  }
  const first = index.notebooks[0];
  const section = remembered ?? (first ? firstSection(index, first.id) : null) ?? index.inbox;
  return withSection('home', section);
}

export function useCurrent(): Current {
  const index = useNotes();
  const ui = useUiState();
  const params = useParams({ strict: false }) as Params;
  const { notebookId, groupId, sectionId, pageId, boardId } = params;
  return useMemo(
    () => resolveCurrent(index, ui, { notebookId, groupId, sectionId, pageId, boardId }),
    [index, ui, notebookId, groupId, sectionId, pageId, boardId],
  );
}

/** Links to places in the notes. */
export function useGo() {
  const navigate = useNavigate();
  return useMemo(
    () => ({
      home: () => void navigate({ to: '/' }),
      notebook: (notebookId: string) =>
        void navigate({ to: '/n/$notebookId', params: { notebookId } }),
      group: (groupId: string) => void navigate({ to: '/g/$groupId', params: { groupId } }),
      section: (sectionId: string, replace = false) =>
        void navigate({ to: '/s/$sectionId', params: { sectionId }, replace }),
      page: (pageId: string, replace = false) =>
        void navigate({ to: '/p/$pageId', params: { pageId }, replace }),
      board: (boardId: string) => void navigate({ to: '/b/$boardId', params: { boardId } }),
    }),
    [navigate],
  );
}
