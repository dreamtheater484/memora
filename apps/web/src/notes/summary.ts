import type { ColorId } from '@memora/shared';
import type { NotesIndex } from './model';

/** What a link's preview shows of the page it leads to (§9.9). */
export interface PageSummary {
  title: string;
  /** Notebook › groups › section. */
  place: string;
  snippet: string;
  color: ColorId | null;
}

export function summaryOf(index: NotesIndex, id: string): PageSummary | null {
  const page = index.page.get(id);
  if (!page) return null;
  const path = index.pathOf(page.sectionId);
  return {
    title: page.title || 'Untitled page',
    place: path
      ? [path.notebook?.name, ...path.groups.map((g) => g.name), path.section.name]
          .filter(Boolean)
          .join(' › ')
      : '',
    snippet: page.snippet,
    color: path?.section.color ?? null,
  };
}
