import type { PaneTabSpec } from '@memora/shared';
import { FileClock, FileText, Link as LinkIcon, Search, SquareKanban } from 'lucide-react';
import type { ReactNode } from 'react';
import { useProjects } from '../kanban/projects';
import { useCurrent } from '../shell/location';

/** A tab's name and icon. */
export function useTabTitle(tab: PaneTabSpec): { title: string; icon: ReactNode } {
  const { index, page: mainPage } = useCurrent();
  const projects = useProjects();
  const pageTitle = (id: string | null) => {
    const page = id ? index.page.get(id) : mainPage;
    return page ? page.title || 'Untitled page' : null;
  };
  switch (tab.kind) {
    case 'page':
      return { title: pageTitle(tab.target) ?? 'Missing page', icon: <FileText /> };
    case 'board':
      return {
        title: projects.boards.find((b) => b.id === tab.target)?.name ?? 'Board',
        icon: <SquareKanban />,
      };
    case 'search':
      return { title: tab.target ? `Search: ${tab.target}` : 'Search', icon: <Search /> };
    case 'backlinks': {
      const of = pageTitle(tab.target);
      return { title: of ? `Backlinks: ${of}` : 'Backlinks', icon: <LinkIcon /> };
    }
    case 'history': {
      const of = pageTitle(tab.target);
      return { title: of ? `History: ${of}` : 'History', icon: <FileClock /> };
    }
  }
}
