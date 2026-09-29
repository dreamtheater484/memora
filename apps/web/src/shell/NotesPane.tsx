import {
  ArrowLeftRight,
  Code,
  Columns2,
  Ellipsis,
  Eye,
  FilePlus,
  FileText,
  Folder,
  LayoutTemplate,
  Link2,
  Maximize2,
  Share2,
  Star,
  X,
} from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  Checkbox,
  Chip,
  EmptyState,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  SectionTabs,
  SegmentedControl,
  toast,
} from '../components/ui';
import { sectionHeading } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { hueStyle } from '../theme/sections';
import { findSection, flatPages, type DemoPage } from './demo';
import { useShell } from './store';

type View = 'source' | 'split' | 'preview';

/** Placeholder page body in the shape of a real note, until the editors land. */
function PageBody({ page, compact }: { page: DemoPage; compact?: boolean }) {
  return (
    <div className={cn('max-w-[47.5rem] text-md leading-relaxed text-fg', compact && 'text-base')}>
      <p className="text-fg-2">{page.snippet}</p>
      <h2 className="mt-7 mb-2.5 font-display text-xl font-semibold tracking-tight">Milestones</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm tabular-nums">
          <thead>
            <tr className="text-left text-2xs tracking-wider text-fg-2 uppercase">
              <th className="border-b border-line px-2 py-2 font-semibold">Milestone</th>
              <th className="border-b border-line px-2 py-2 font-semibold">Owner</th>
              <th className="border-b border-line px-2 py-2 text-right font-semibold">Due</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Offline outbox', 'Alex', 'Oct 10'],
              ['Search polish', 'Sam', 'Oct 24'],
              ['Board swimlanes', 'Priya', 'Nov 7'],
            ].map(([m, o, d]) => (
              <tr key={m}>
                <td className="border-b border-line px-2 py-2">{m}</td>
                <td className="border-b border-line px-2 py-2">{o}</td>
                <td className="border-b border-line px-2 py-2 text-right whitespace-nowrap">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="mt-7 mb-2.5 font-display text-xl font-semibold tracking-tight">This week</h2>
      <ul className="flex flex-col gap-1.5">
        {[
          ['Replay the outbox in order after reconnecting', true],
          ['Keep the offline badge until the outbox is empty', true],
          ['Show a conflict when the server has a newer revision', false],
        ].map(([t, done]) => (
          <li key={String(t)} className="flex items-start gap-2.5">
            <Checkbox checked={done as boolean} aria-label={String(t)} className="mt-1" />
            <span className={cn(done && 'text-fg-3 line-through decoration-fg-3/50')}>{t}</span>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex gap-3 rounded-sm border border-accent/25 bg-accent/7 px-3.5 py-3 text-sm">
        <FileText className="mt-0.5 size-4 shrink-0 text-accent" />
        <p>
          <b className="block">Placeholder page</b>
          The Markdown editor arrives in Phase 5 and the rich-text editor in Phase 6. This shell
          shows the layout.
        </p>
      </div>
    </div>
  );
}

function PageHead({
  page,
  view,
  setView,
}: {
  page: DemoPage;
  view: View;
  setView: (v: View) => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2 px-4 pt-3.5 pb-2.5 @tablet:px-7 @tablet:pt-5.5 @tablet:pb-3.5 @wide:px-9">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate font-display text-[1.4375rem] leading-tight font-semibold tracking-[-0.03em] @tablet:text-[2.125rem]">
          {page.title}
        </h1>
        <div className="flex shrink-0 items-center gap-1">
          {page.kind === 'markdown' && (
            <span className="hidden @tablet:contents">
              <SegmentedControl
                label="View"
                value={view}
                onValueChange={setView}
                segments={[
                  { value: 'source', label: 'Source', icon: <Code />, iconOnly: true },
                  { value: 'split', label: 'Split', icon: <Columns2 />, iconOnly: true },
                  { value: 'preview', label: 'Preview', icon: <Eye />, iconOnly: true },
                ]}
              />
            </span>
          )}
          <IconButton label="Favourite" icon={<Star />} />
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="Page actions" icon={<Ellipsis />} />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<Link2 />}>Copy link</MenuItem>
              <MenuItem icon={<Share2 />}>Export…</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-3">
        <span>Edited {page.edited}</span>
        <span>{page.kind === 'markdown' ? 'Markdown' : 'Rich text'}</span>
        <Chip>#roadmap</Chip>
        <Chip>#q4</Chip>
      </div>
    </div>
  );
}

/** The main pane: section tabs, then the page (or an empty state). */
export function NotesPane() {
  const { sectionId, pageId, openSection } = useShell();
  const [view, setView] = useState<View>('preview');
  const found = findSection(sectionId);
  if (!found) return null;
  const { notebook, section } = found;
  const page = flatPages(sectionId).find((p) => p.id === pageId);
  const group = notebook.sections.find((s) => s.group)?.group;

  return (
    <section aria-label="Editor" className="flex h-full min-h-0 flex-col">
      <SectionTabs
        className="shrink-0 px-2 pt-2 @tablet:px-3.5 @tablet:pt-3"
        sections={notebook.sections.map((s, i) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          divider: i > 0 && !s.group && !!notebook.sections[i - 1]?.group,
        }))}
        value={sectionId}
        onValueChange={openSection}
        onAdd={() => toast('Creating sections arrives in Phase 3.')}
        panelId="page-panel"
        leading={
          group && (
            <span
              className={cn(
                sectionHeading,
                'mr-1 hidden shrink-0 items-center gap-1.5 pl-1 @tablet:inline-flex',
              )}
            >
              <Folder className="size-3.5" /> {group}
            </span>
          )
        }
      />
      <div
        id="page-panel"
        role="tabpanel"
        aria-labelledby={`sectab-${sectionId}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {page ? (
          <>
            <PageHead page={page} view={view} setView={setView} />
            <div className="min-h-0 flex-1 overflow-auto px-4 pb-14 @tablet:px-7 @wide:px-9">
              <PageBody page={page} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<FilePlus />}
            color={section.color}
            title={`No pages in ${section.name} yet`}
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
        )}
      </div>
    </section>
  );
}

/** Second editor pane (ultra-wide): another page open beside the main one. */
export function SecondPane() {
  const { setSecondPane } = useShell();
  const page = flatPages('roadmap').find((p) => p.id === 'drn')!;
  return (
    <section aria-label="Second pane" className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2.5 pl-4 text-sm whitespace-nowrap text-fg-2">
        <span className="hue flex items-center gap-2" style={hueStyle('blue')}>
          <span aria-hidden className="size-2 rounded-full bg-sec" />
          Roadmap
        </span>
        <span aria-hidden>›</span>
        <b className="truncate font-semibold text-fg">{page.title}</b>
        <Chip>
          <Eye /> Preview
        </Chip>
        <span className="flex-1" />
        <IconButton label="Swap panes" icon={<ArrowLeftRight />} />
        <IconButton label="Open in the main pane" icon={<Maximize2 />} />
        <IconButton label="Close pane" icon={<X />} onClick={() => setSecondPane(false)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-11 pt-7 pb-14">
        <h2 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight">
          {page.title}
        </h2>
        <p className="mb-4 text-sm text-fg-3">Roadmap · edited {page.edited}</p>
        <PageBody page={page} compact />
      </div>
    </section>
  );
}
