import {
  ArrowUpDown,
  Code,
  Columns2,
  Copy,
  Eye,
  FilePlus,
  FileText,
  Folder,
  LayoutTemplate,
  ListFilter,
  Moon,
  Notebook,
  Pencil,
  Plus,
  Search,
  Settings,
  Share2,
  SquareKanban,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Checkbox,
  Chip,
  CommandPalette,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  EmptyState,
  Field,
  IconButton,
  Input,
  Kbd,
  Logo,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  PageTree,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SaveIndicator,
  SectionTabs,
  SegmentedControl,
  Select,
  Sheet,
  SheetContent,
  SheetTrigger,
  Skeleton,
  SplitPane,
  Switch,
  Tooltip,
  toast,
  type PaletteItem,
  type SaveState,
  type TreeNode,
} from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { SECTION_COLORS, applyAccent, hueStyle, type SectionColorId } from '../theme/sections';
import { applyAppearance, type GlassMode, type ThemeMode } from '../theme/theme';

const TABS = [
  { id: 'roadmap', name: 'Roadmap', color: 'blue' },
  { id: 'research', name: 'Research', color: 'teal' },
  { id: 'meetings', name: 'Meetings', color: 'amber' },
  { id: 'team', name: 'Team', color: 'violet', divider: true },
  { id: 'archive', name: 'Archive', color: 'slate' },
] as const;

interface DemoNode extends TreeNode {
  kind: 'notebook' | 'group' | 'section';
  color: SectionColorId;
  children?: DemoNode[];
}

const TREE: DemoNode[] = [
  {
    id: 'work',
    label: 'Work',
    kind: 'notebook',
    color: 'indigo',
    children: [
      {
        id: 'projects',
        label: 'Projects',
        kind: 'group',
        color: 'indigo',
        selectable: false,
        children: [
          { id: 'roadmap', label: 'Roadmap', kind: 'section', color: 'blue' },
          { id: 'research', label: 'Research', kind: 'section', color: 'teal' },
        ],
      },
      { id: 'team', label: 'Team', kind: 'section', color: 'violet' },
    ],
  },
  {
    id: 'personal',
    label: 'Personal',
    kind: 'notebook',
    color: 'green',
    children: [
      { id: 'travel', label: 'Travel', kind: 'section', color: 'cyan' },
      { id: 'recipes', label: 'Recipes', kind: 'section', color: 'orange' },
    ],
  },
];

const SAVE_STATES: { state: SaveState; pending?: number }[] = [
  { state: 'saved' },
  { state: 'saving' },
  { state: 'local', pending: 3 },
  { state: 'conflict' },
  { state: 'failed' },
];

function Demo({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid={`demo-${id}`}
      aria-labelledby={`demo-${id}-h`}
      className="glass rounded-2xl p-5"
    >
      <h2 id={`demo-${id}-h`} className={cn(sectionHeading, 'mb-4')}>
        {title}
      </h2>
      <div className={cn('flex flex-wrap items-center gap-3', className)}>{children}</div>
    </section>
  );
}

export function Gallery({
  initialTheme,
  initialGlass,
}: {
  initialTheme: ThemeMode;
  initialGlass: GlassMode;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [glass, setGlass] = useState(initialGlass);
  const [accent, setAccent] = useState<SectionColorId>('blue');
  const [tab, setTab] = useState<string>('roadmap');
  const [treeSel, setTreeSel] = useState<string>('roadmap');
  const [view, setView] = useState<'source' | 'split' | 'preview'>('split');
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [sort, setSort] = useState('updated');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [density, setDensity] = useState('comfortable');

  function changeTheme(t: ThemeMode) {
    setTheme(t);
    applyAppearance({ theme: t, glass });
  }
  function changeGlass(g: GlassMode) {
    setGlass(g);
    applyAppearance({ theme, glass: g });
  }
  function changeAccent(id: SectionColorId) {
    setAccent(id);
    applyAccent(id);
  }

  const paletteItems: PaletteItem[] = [
    {
      id: 'q4',
      title: 'Q4 roadmap',
      subtitle: 'Work › Roadmap',
      group: 'Pages',
      icon: <FileText />,
      hint: '2 min ago',
      onSelect: () => toast('Opened Q4 roadmap'),
    },
    {
      id: 'comp',
      title: 'Competitor notes',
      subtitle: 'Work › Research',
      group: 'Pages',
      icon: <FileText />,
      hint: 'Today',
      onSelect: () => toast('Opened Competitor notes'),
    },
    {
      id: 'web14',
      title: 'Offline outbox for the editor',
      subtitle: 'Website relaunch · In progress',
      group: 'Cards',
      icon: <SquareKanban />,
      hint: 'WEB-14',
      onSelect: () => toast('Opened WEB-14'),
    },
    {
      id: 'new',
      title: 'New page',
      group: 'Commands',
      icon: <FilePlus />,
      hint: <Kbd>Ctrl Alt N</Kbd>,
      onSelect: () => toast('New page'),
    },
    {
      id: 'dark',
      title: 'Switch to dark theme',
      group: 'Commands',
      icon: <Moon />,
      keywords: 'appearance',
      onSelect: () => changeTheme('dark'),
    },
    {
      id: 'light',
      title: 'Switch to light theme',
      group: 'Commands',
      icon: <Sun />,
      keywords: 'appearance',
      onSelect: () => changeTheme('light'),
    },
  ];

  return (
    <div className="aurora-bg h-full overflow-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 tablet:p-8">
        <header className="flex flex-wrap items-center gap-3">
          <Logo className="size-8" />
          <h1 className="font-display text-3xl font-bold tracking-tight">Component gallery</h1>
          <span className="flex-1" />
          <SegmentedControl
            label="Theme"
            value={theme}
            onValueChange={changeTheme}
            segments={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
          <SegmentedControl
            label="Glass"
            value={glass}
            onValueChange={changeGlass}
            segments={[
              { value: 'auto', label: 'Auto' },
              { value: 'on', label: 'Glass' },
              { value: 'off', label: 'Solid' },
            ]}
          />
        </header>

        <Demo id="colors" title="Section colours (click to set the accent)">
          {SECTION_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => changeAccent(c.id)}
              aria-pressed={accent === c.id}
              style={hueStyle(c.id)}
              className="hue flex w-24 flex-col items-center gap-1.5 rounded-md p-2 text-xs font-medium text-fg-2 hover:bg-hover aria-pressed:bg-active aria-pressed:shadow-card"
            >
              <span className="h-8 w-full rounded-sm bg-sec" />
              <span className="flex w-full">
                <span className="h-3 flex-1 rounded-l-xs bg-sec-soft" />
                <span className="h-3 flex-1 rounded-r-xs bg-sec-softer" />
              </span>
              <span className="text-sec-ink">{c.name}</span>
            </button>
          ))}
        </Demo>

        <Demo id="type" title="Type" className="flex-col items-start gap-1">
          <p className="font-display text-4xl font-semibold tracking-tight">Q4 roadmap</p>
          <p className="font-display text-xl font-semibold">Milestones for the quarter</p>
          <p className="max-w-prose text-md text-fg">
            Figtree for the interface and body text, Bricolage Grotesque for titles and JetBrains
            Mono for code:{' '}
            <code className="rounded-xs bg-hover px-1 font-mono text-[0.86em]">
              | Owner | Due |
            </code>
          </p>
          <p className="text-sm text-fg-2">Secondary text · 13 px</p>
          <p className="text-xs text-fg-3">Tertiary text, still AA on glass · 12 px</p>
        </Demo>

        <Demo id="buttons" title="Buttons">
          <Button variant="primary">
            <Plus /> New page
          </Button>
          <Button>
            <LayoutTemplate /> From a template
          </Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">
            <Trash2 /> Delete
          </Button>
          <Button size="sm" variant="primary">
            <Plus /> Page
          </Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
          <span className="mx-2 h-6 w-px bg-line-strong" />
          <IconButton label="Search" icon={<Search />} shortcut="Ctrl K" />
          <IconButton label="Favourite" icon={<Star />} active />
          <IconButton label="Settings" icon={<Settings />} size="sm" />
          <IconButton label="New section" icon={<Plus />} size="sm" round />
          <IconButton label="Sort" icon={<ArrowUpDown />} size="xs" />
        </Demo>

        <Demo id="fields" title="Fields and toggles" className="items-start">
          <Field label="Page title" hint="Shown in the page list and search.">
            {({ id, describedBy }) => (
              <Input id={id} aria-describedby={describedBy} defaultValue="Q4 roadmap" />
            )}
          </Field>
          <Field label="Email" error="Enter a valid email address.">
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                defaultValue="not-an-email"
              />
            )}
          </Field>
          <Input
            pill
            icon={<ListFilter />}
            placeholder="Filter pages"
            aria-label="Filter pages"
            wrapperClassName="w-56 self-end"
          />
          <Select
            aria-label="Sort pages"
            value={sort}
            onValueChange={setSort}
            className="self-end"
            options={[
              { value: 'updated', label: 'Last edited' },
              { value: 'created', label: 'Date created' },
              { value: 'title', label: 'Title' },
              { value: 'manual', label: 'Manual order' },
            ]}
          />
          <div className="flex flex-col gap-3 self-end">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} /> Include
              subpages
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked="indeterminate" /> Some selected
            </label>
          </div>
          <div className="flex flex-col gap-3 self-end">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} /> Spell check
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch disabled /> Disabled
            </label>
          </div>
          <SegmentedControl
            label="View"
            value={view}
            onValueChange={setView}
            className="self-end"
            segments={[
              { value: 'source', label: 'Source', icon: <Code /> },
              { value: 'split', label: 'Split', icon: <Columns2 /> },
              { value: 'preview', label: 'Preview', icon: <Eye /> },
            ]}
          />
        </Demo>

        <Demo id="tabs" title="Section tabs">
          <div className="w-full rounded-xl bg-surface p-3">
            <SectionTabs
              sections={TABS}
              value={tab}
              onValueChange={setTab}
              onAdd={() => toast('New section')}
              leading={
                <span
                  className={cn(sectionHeading, 'mr-1 inline-flex shrink-0 items-center gap-1.5')}
                >
                  <Folder className="size-3.5" /> Projects
                </span>
              }
            />
          </div>
        </Demo>

        <div className="grid gap-4 desktop:grid-cols-2">
          <Demo id="tree" title="Page tree" className="block">
            <PageTree
              label="Notebooks"
              nodes={TREE}
              selectedId={treeSel}
              onSelect={(n) => setTreeSel(n.id)}
              defaultExpanded={['work', 'projects']}
              renderRow={(node) => (
                <span className="hue flex min-w-0 items-center gap-2" style={hueStyle(node.color)}>
                  {node.kind === 'notebook' && (
                    <span className="grid size-5 shrink-0 place-items-center rounded-[6px] bg-sec text-on-accent">
                      <Notebook className="size-3" strokeWidth={2.2} />
                    </span>
                  )}
                  {node.kind === 'group' && <Folder className="size-4 shrink-0 text-fg-3" />}
                  {node.kind === 'section' && (
                    <span className="size-2.5 shrink-0 rounded-full bg-sec" />
                  )}
                  <span className="truncate">{node.label}</span>
                </span>
              )}
            />
          </Demo>

          <Demo
            id="status"
            title="Save indicator, chips, badges, avatars"
            className="flex-col items-start"
          >
            <div className="@container flex w-full flex-wrap gap-2">
              {SAVE_STATES.map((s) => (
                <SaveIndicator key={s.state} state={s.state} pending={s.pending} compact={false} />
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {SAVE_STATES.map((s) => (
                <SaveIndicator key={s.state} state={s.state} pending={s.pending} compact />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip>#roadmap</Chip>
              <Chip color="teal">Research</Chip>
              <Chip
                color="coral"
                onRemove={() => toast('Removed')}
                removeLabel="Remove label Urgent"
              >
                Urgent
              </Chip>
              <Badge>12</Badge>
              <Badge tone="accent">3</Badge>
              <Badge tone="ok">Done</Badge>
              <Badge tone="warn">WIP 4/4</Badge>
              <Badge tone="danger">Overdue</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Avatar name="Alex Morgan" />
              <Avatar name="Sam Kaur" />
              <Avatar name="Priya Rao" size="lg" />
              <Avatar name="Jo" size="sm" />
            </div>
          </Demo>
        </div>

        <Demo id="overlays" title="Menus, dialogs, sheets and popovers">
          <Menu>
            <MenuTrigger asChild>
              <Button>Page menu</Button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuLabel>Page</MenuLabel>
              <MenuItem icon={<Pencil />} shortcut="F2">
                Rename
              </MenuItem>
              <MenuItem icon={<Copy />} shortcut="Ctrl D">
                Duplicate
              </MenuItem>
              <MenuSub>
                <MenuSubTrigger icon={<Share2 />}>Export</MenuSubTrigger>
                <MenuSubContent>
                  <MenuItem>Markdown (.md)</MenuItem>
                  <MenuItem>Word (.docx)</MenuItem>
                  <MenuItem>PDF</MenuItem>
                </MenuSubContent>
              </MenuSub>
              <MenuSeparator />
              <MenuCheckboxItem checked={showHidden} onCheckedChange={setShowHidden}>
                Show hidden pages
              </MenuCheckboxItem>
              <MenuRadioGroup value={density} onValueChange={setDensity}>
                <MenuRadioItem value="comfortable">Comfortable</MenuRadioItem>
                <MenuRadioItem value="compact">Compact</MenuRadioItem>
              </MenuRadioGroup>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger shortcut="Del">
                Move to recycle bin
              </MenuItem>
            </MenuContent>
          </Menu>

          <ContextMenu>
            <ContextMenuTrigger className="grid h-8 place-items-center rounded-sm border border-dashed border-line-strong px-3 text-sm text-fg-2">
              Right-click here
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem icon={<Pencil />}>Rename</ContextMenuItem>
              <ContextMenuItem icon={<Copy />}>Duplicate</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem icon={<Trash2 />} danger>
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>

          <Dialog>
            <DialogTrigger asChild>
              <Button>Dialog</Button>
            </DialogTrigger>
            <DialogContent
              title="Move to recycle bin?"
              description="“Q4 roadmap” and its 2 subpages can be restored for 30 days."
              footer={
                <>
                  <DialogClose asChild>
                    <Button variant="ghost">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button
                      variant="primary"
                      onClick={() =>
                        toast({
                          title: 'Moved to recycle bin',
                          action: { label: 'Undo', onClick: () => toast('Restored') },
                        })
                      }
                    >
                      Move
                    </Button>
                  </DialogClose>
                </>
              }
            >
              <p className="text-sm text-fg-2">
                Links to these pages will show as missing until you restore them.
              </p>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button>Sheet</Button>
            </SheetTrigger>
            <SheetContent side="right" title="Pages" showTitle>
              <p className="p-4 text-sm text-fg-2">
                Drawers hold the sidebar and page list on phones and tablets.
              </p>
            </SheetContent>
          </Sheet>

          <Popover>
            <PopoverTrigger asChild>
              <Button>Popover</Button>
            </PopoverTrigger>
            <PopoverContent>
              <p className="mb-2 text-sm font-semibold">Section colour</p>
              <div className="grid grid-cols-6 gap-2">
                {SECTION_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    aria-label={c.name}
                    style={hueStyle(c.id)}
                    className="hue size-7 rounded-full bg-sec"
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Tooltip content="Tooltips show on hover and keyboard focus" shortcut="?">
            <Button variant="ghost">Tooltip</Button>
          </Tooltip>

          <Button onClick={() => toast({ title: 'Page saved', tone: 'success' })}>Toast</Button>
          <Button onClick={() => setPaletteOpen(true)}>
            <Search /> Command palette <Kbd>Ctrl K</Kbd>
          </Button>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            items={paletteItems}
            renderPreview={(item) => (
              <div>
                <p className="text-xs text-fg-3">{item.subtitle ?? item.group}</p>
                <p className="mt-1.5 font-display text-xl font-semibold">{item.title}</p>
                <p className="mt-3 text-sm text-fg-2">
                  A preview of the selected result appears here on wide screens.
                </p>
              </div>
            )}
          />
        </Demo>

        <div className="grid gap-4 desktop:grid-cols-2">
          <Demo id="empty" title="Empty state" className="block">
            <EmptyState
              icon={<FilePlus />}
              color="teal"
              title="No pages in Research yet"
              description="Start with a blank page or pick a template. Markdown and rich text are both one click away."
              actions={
                <>
                  <Button variant="primary">
                    <FilePlus /> New page
                  </Button>
                  <Button>
                    <LayoutTemplate /> From a template
                  </Button>
                </>
              }
              hint="Or drop .md, .docx or .memora files here to import them."
            />
          </Demo>
          <Demo id="skeleton" title="Loading" className="flex-col items-stretch">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-sm p-2">
                <Skeleton className="h-3.5 w-1/2" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-2.5 w-1/5" />
              </div>
            ))}
          </Demo>
        </div>

        <Demo
          id="split"
          title="Split pane (drag the divider or use the arrow keys)"
          className="block"
        >
          <SplitPane
            className="h-48"
            label="Resize the second pane"
            first={
              <div className="h-full rounded-xl bg-surface p-4 text-sm text-fg-2">Main pane</div>
            }
            second={
              <div className="h-full rounded-xl bg-surface p-4 text-sm text-fg-2">Second pane</div>
            }
          />
        </Demo>
      </div>
    </div>
  );
}
