import type { ColorId, PageMeta } from '@memora/shared';
import { ChevronRight, Folder, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import type { NotesIndex } from '../notes/model';
import { hueStyle } from '../theme/sections';
import { useCurrent, useGo } from './location';
import { NotebookTile } from './parts';

interface Crumb {
  id: string;
  label: string;
  icon?: ReactNode;
  color?: ColorId;
  onClick: () => void;
}

/** A subpage's parent pages, from the outermost in. */
function parentsOf(index: NotesIndex, page: PageMeta): PageMeta[] {
  const parents: PageMeta[] = [];
  let parent = page.parentPageId ? index.page.get(page.parentPageId) : undefined;
  // Subpages go three levels deep; the limit only guards against a broken tree.
  while (parent && parents.length < 8) {
    parents.unshift(parent);
    parent = parent.parentPageId ? index.page.get(parent.parentPageId) : undefined;
  }
  return parents;
}

/**
 * Where a page is, shown above its title: notebook › section groups › section › parent
 * pages. Each part opens that place.
 */
export function PageLocation({ page, className }: { page: PageMeta; className?: string }) {
  const { index } = useCurrent();
  const go = useGo();
  const path = index.pathOf(page.sectionId);
  if (!path) return null;
  const { notebook, groups, section } = path;
  const crumbs: Crumb[] = [
    ...(notebook
      ? [
          {
            id: notebook.id,
            label: notebook.name,
            icon: (
              <NotebookTile
                icon={notebook.icon}
                className="size-4 rounded-[5px] [&>svg]:size-2.5"
              />
            ),
            color: notebook.color,
            onClick: () => go.notebook(notebook.id),
          },
        ]
      : []),
    ...groups.map((g) => ({
      id: g.id,
      label: g.name,
      icon: <Folder className="text-fg-3" />,
      onClick: () => go.group(g.id),
    })),
    {
      id: section.id,
      label: section.isInbox ? 'Inbox' : section.name,
      icon: section.isInbox ? (
        <Inbox />
      ) : (
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-sec" />
      ),
      color: section.color,
      onClick: () => go.section(section.id),
    },
    ...parentsOf(index, page).map((p) => ({
      id: p.id,
      label: p.title || 'Untitled page',
      onClick: () => go.page(p.id),
    })),
  ];
  return (
    <nav
      aria-label={`Location of ${page.title || 'Untitled page'}`}
      className={cn('min-w-0 text-sm text-fg-2', className)}
    >
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((c, i) => (
          <li key={c.id} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-3" />}
            <button
              type="button"
              onClick={c.onClick}
              style={c.color ? hueStyle(c.color) : undefined}
              className={cn(
                c.color && 'hue',
                'flex min-w-0 items-center gap-1.5 rounded-xs whitespace-nowrap hover:text-fg [&>svg]:size-3.5 [&>svg]:shrink-0',
              )}
            >
              {c.icon}
              <span className="truncate">{c.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
