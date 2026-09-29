import {
  Clock,
  Folder,
  LayoutTemplate,
  Notebook,
  Plus,
  Search,
  Settings,
  SquareKanban,
  Star,
  Trash2,
} from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { IconButton, Kbd, PageTree, toast, type TreeNode } from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { hueStyle, type SectionColorId } from '../theme/sections';
import { NOTEBOOKS, PROJECTS } from './demo';
import { useShell } from './store';

interface NavNode extends TreeNode {
  kind: 'notebook' | 'group' | 'section' | 'project' | 'board';
  color: SectionColorId;
  children?: NavNode[];
}

function notebookTree(): NavNode[] {
  return NOTEBOOKS.map((nb) => {
    const children: NavNode[] = [];
    const groups = new Map<string, NavNode>();
    for (const s of nb.sections) {
      const node: NavNode = { id: s.id, label: s.name, kind: 'section', color: s.color };
      if (!s.group) {
        children.push(node);
        continue;
      }
      let group = groups.get(s.group);
      if (!group) {
        group = {
          id: `${nb.id}/${s.group}`,
          label: s.group,
          kind: 'group',
          color: nb.color,
          selectable: false,
          children: [],
        };
        groups.set(s.group, group);
        children.push(group);
      }
      group.children!.push(node);
    }
    return {
      id: nb.id,
      label: nb.name,
      kind: 'notebook',
      color: nb.color,
      selectable: false,
      children,
    };
  });
}

function boardTree(): NavNode[] {
  return PROJECTS.map((p) => ({
    id: p.id,
    label: p.name,
    kind: 'project',
    color: p.color,
    selectable: false,
    children: p.boards.map((b) => ({ id: b.id, label: b.name, kind: 'board', color: p.color })),
  }));
}

function NavRow({ node }: { node: NavNode }) {
  return (
    <span className="hue flex min-w-0 flex-1 items-center gap-2" style={hueStyle(node.color)}>
      {(node.kind === 'notebook' || node.kind === 'project') && (
        <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-sec text-on-accent">
          {node.kind === 'notebook' ? (
            <Notebook className="size-3" strokeWidth={2.2} />
          ) : (
            <SquareKanban className="size-3" strokeWidth={2.2} />
          )}
        </span>
      )}
      {node.kind === 'group' && <Folder className="size-4 shrink-0 text-fg-3" />}
      {(node.kind === 'section' || node.kind === 'board') && (
        <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-sec" />
      )}
      <span className="truncate">{node.label}</span>
    </span>
  );
}

function Heading({
  children,
  onAdd,
  addLabel,
}: {
  children: ReactNode;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div
      className={cn(sectionHeading, 'flex items-center justify-between pt-3.5 pr-1 pb-1 pl-2.5')}
    >
      <span>{children}</span>
      <IconButton label={addLabel} icon={<Plus />} size="xs" onClick={onAdd} />
    </div>
  );
}

function Row({
  icon,
  children,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-[1.875rem] w-full items-center gap-2 rounded-sm px-2 text-left text-base whitespace-nowrap text-fg-2 hover:bg-hover hover:text-fg [&>svg]:size-4 [&>svg]:shrink-0"
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </button>
  );
}

// Static placeholder data, so the trees are built once.
const NOTEBOOK_TREE = notebookTree();
const BOARD_TREE = boardTree();

const soon = (what: string, phase: number) => () => toast(`${what} arrives in Phase ${phase}.`);

/** Navigation: quick links, notebooks with section groups, boards, and the footer. */
export function Sidebar() {
  const { view, sectionId, openSection, openBoard, setPaletteOpen } = useShell();
  const navigate = useNavigate();
  const selected = view.kind === 'notes' ? sectionId : null;

  return (
    <nav aria-label="Navigation" className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto px-2 pt-2.5 pb-3">
        <Row icon={<Search />} onClick={() => setPaletteOpen(true)} trailing={<Kbd>Ctrl K</Kbd>}>
          Search
        </Row>
        <Row icon={<Clock />} onClick={soon('Recent pages', 7)}>
          Recent
        </Row>
        <Row icon={<Star />} onClick={soon('Favourites', 7)}>
          Favourites
        </Row>

        <Heading addLabel="New notebook" onAdd={soon('Creating notebooks', 3)}>
          Notebooks
        </Heading>
        <PageTree
          label="Notebooks"
          nodes={NOTEBOOK_TREE}
          selectedId={selected}
          defaultExpanded={['work', 'work/Projects']}
          onSelect={(n) => openSection(n.id)}
          renderRow={(node) => <NavRow node={node} />}
        />

        <Heading addLabel="New project" onAdd={soon('Boards', 10)}>
          Boards
        </Heading>
        <PageTree
          label="Boards"
          nodes={BOARD_TREE}
          selectedId={view.kind === 'board' ? view.boardId : null}
          defaultExpanded={['web']}
          onSelect={(n) => openBoard(n.id)}
          renderRow={(node) => <NavRow node={node} />}
        />
      </div>
      <div className="shrink-0 border-t border-line px-2 py-1.5">
        <Row icon={<LayoutTemplate />} onClick={soon('Templates', 7)}>
          Templates
        </Row>
        <Row
          icon={<Trash2 />}
          onClick={soon('The recycle bin', 4)}
          trailing={<span className="text-xs text-fg-3 tabular-nums">3</span>}
        >
          Recycle bin
        </Row>
        <Row icon={<Settings />} onClick={() => void navigate({ to: '/settings/account' })}>
          Settings
        </Row>
      </div>
    </nav>
  );
}

/** Tablet navigation: one button per notebook; they open the full sidebar as a drawer. */
export function Rail() {
  const { view, sectionId, setNavOpen, setPaletteOpen, openBoard } = useShell();
  const navigate = useNavigate();
  const current = NOTEBOOKS.find((nb) => nb.sections.some((s) => s.id === sectionId));
  return (
    <nav aria-label="Notebooks" className="flex h-full flex-col items-center gap-1.5 py-3">
      {NOTEBOOKS.map((nb) => {
        const on = view.kind === 'notes' && nb === current;
        return (
          <button
            key={nb.id}
            type="button"
            title={nb.name}
            aria-label={nb.name}
            aria-current={on || undefined}
            onClick={() => setNavOpen(true)}
            style={hueStyle(nb.color)}
            className={cn(
              'hue grid size-9 place-items-center rounded-[11px] text-base font-bold',
              on ? 'bg-sec text-on-accent' : 'bg-sec-soft text-sec-ink',
            )}
          >
            {nb.name[0]}
          </button>
        );
      })}
      <span aria-hidden className="my-1.5 h-px w-6 bg-line" />
      <IconButton
        label="Boards"
        icon={<SquareKanban />}
        active={view.kind === 'board'}
        tooltipSide="right"
        onClick={() => openBoard(PROJECTS[0]!.boards[0]!.id)}
      />
      <IconButton
        label="Search"
        icon={<Search />}
        tooltipSide="right"
        onClick={() => setPaletteOpen(true)}
      />
      <span className="flex-1" />
      <IconButton
        label="Recycle bin"
        icon={<Trash2 />}
        tooltipSide="right"
        onClick={soon('The recycle bin', 4)}
      />
      <IconButton
        label="Settings"
        icon={<Settings />}
        tooltipSide="right"
        onClick={() => void navigate({ to: '/settings/account' })}
      />
    </nav>
  );
}
