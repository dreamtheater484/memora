import { ArrowUpDown, FileCode2, FileText, ListFilter, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, IconButton, Input, PageTree, toast, type TreeNode } from '../components/ui';
import { hueStyle } from '../theme/sections';
import { findSection, PAGES, type DemoPage } from './demo';
import { useShell } from './store';

interface PageNode extends TreeNode {
  page: DemoPage;
  children?: PageNode[];
}

function toNodes(pages: DemoPage[], filter: string): PageNode[] {
  const q = filter.trim().toLowerCase();
  const out: PageNode[] = [];
  for (const page of pages) {
    const children = toNodes(page.children ?? [], filter);
    const matches =
      !q || page.title.toLowerCase().includes(q) || page.snippet.toLowerCase().includes(q);
    if (matches || children.length) {
      out.push({
        id: page.id,
        label: page.title,
        page,
        children: children.length ? children : undefined,
      });
    }
  }
  return out;
}

function allIds(nodes: PageNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...allIds(n.children ?? [])]);
}

/** Pages of the current section, subpages nested under their parent. */
export function PageList() {
  const { sectionId, pageId, openPage } = useShell();
  const [filter, setFilter] = useState('');
  const found = findSection(sectionId);
  const nodes = toNodes(PAGES[sectionId] ?? [], filter);
  const count = allIds(toNodes(PAGES[sectionId] ?? [], '')).length;
  if (!found) return null;
  const { section } = found;

  return (
    <aside
      aria-label="Pages"
      className="hue flex h-full min-h-0 flex-col"
      style={hueStyle(section.color)}
    >
      <div className="flex shrink-0 items-center gap-1.5 pt-3.5 pr-3 pb-2.5 pl-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-md font-semibold">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-sec" />
            <span className="truncate">{section.name}</span>
          </h2>
          <span className="text-xs text-fg-3">
            {count} {count === 1 ? 'page' : 'pages'}
          </span>
        </div>
        <span className="flex-1" />
        <IconButton label="Sort" icon={<ArrowUpDown />} />
        <Button
          size="sm"
          variant="primary"
          onClick={() => toast('Creating pages arrives with the editor (Phase 5).')}
        >
          <Plus /> Page
        </Button>
      </div>
      <Input
        pill
        icon={<ListFilter />}
        placeholder="Filter pages"
        aria-label="Filter pages"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        wrapperClassName="mx-3 mb-2 shrink-0"
      />
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3.5">
        {nodes.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-fg-3">
            {filter ? 'No pages match this filter' : 'No pages yet'}
          </p>
        ) : (
          <PageTree
            // Remount per section and filter, so everything starts expanded.
            key={`${sectionId}:${filter}`}
            label={`Pages in ${section.name}`}
            nodes={nodes}
            selectedId={pageId}
            onSelect={(n) => openPage(n.id)}
            defaultExpanded={allIds(nodes)}
            indent={1.125}
            multiline
            renderRow={({ page }) => (
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 text-base font-semibold text-fg">
                  {page.kind === 'markdown' ? (
                    <FileCode2 className="size-3.5 shrink-0 text-fg-3" />
                  ) : (
                    <FileText className="size-3.5 shrink-0 text-fg-3" />
                  )}
                  <span className="truncate">{page.title}</span>
                </span>
                <span className="mt-0.5 truncate text-sm font-normal text-fg-3">
                  {page.snippet}
                </span>
                <span className="mt-0.5 text-2xs font-normal text-fg-3">{page.edited}</span>
              </span>
            )}
          />
        )}
      </div>
    </aside>
  );
}
