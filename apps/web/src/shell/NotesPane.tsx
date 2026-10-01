import type { PageMeta } from '@memora/shared';
import {
  Copy,
  Ellipsis,
  FileClock,
  FilePlus,
  FileQuestion,
  FolderInput,
  LayoutTemplate,
  Link2,
  MoveHorizontal,
  NotebookPen,
  PenLine,
  Plus,
  Repeat,
  Save,
  Share2,
  SquareKanban,
  Star,
  Trash2,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  Button,
  Dialog,
  EmptyState,
  IconButton,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  toast,
} from '../components/ui';
import { cn } from '../lib/cn';
import { focusPage } from '../editor/jumps';
import { useFocusOnMount } from '../lib/useFocusOnMount';
import { formatDateTime, formatRelative } from '../lib/time';
import { isFavorite, toggleFavorite, toggleFullWidth } from '../notes/places';
import { saveUiState, useNotesActions, useUiState } from '../notes/queries';
import type { PageDoc } from '../sync/doc';
import { pickTemplate, useTemplates } from '../templates/templates';
import { usePageDoc } from '../sync/hooks';
import { useCommands } from './commands';
import { ConvertDialog } from './ConvertDialog';
import { useCurrent, useGo } from './location';
import { PageBody, PageSaveIndicator, PresenceHint } from './PageEditor';
import { PageTags } from './PageTags';
import { SectionBar } from './SectionBar';
import { shortcutKeys } from './shortcuts';
import { useShell } from './store';

function TitleEditor({ page }: { page: PageMeta }) {
  const actions = useNotesActions();
  const [text, setText] = useState(page.title);
  const ref = useRef<HTMLInputElement>(null);
  // Editing starts on request (a click, F2, a new page), so the field takes focus.
  useFocusOnMount(ref);
  const finish = (save: boolean) => {
    useShell.getState().setEditingTitle(null);
    if (save && text.trim() !== page.title) void actions.updatePage(page.id, { title: text });
  };
  return (
    <input
      ref={ref}
      aria-label="Page title"
      placeholder="Untitled page"
      value={text}
      maxLength={200}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          // As in a notebook: Enter in the title goes on to the page's text.
          // At once, so nothing typed next is lost; the field's blur saves the title.
          e.preventDefault();
          focusPage(page.id);
          if (document.activeElement === e.currentTarget) finish(true);
        }
        if (e.key === 'Escape') finish(false);
      }}
      className="w-full min-w-0 rounded-sm bg-transparent font-display text-[1.4375rem] leading-tight font-semibold tracking-[-0.03em] outline-none placeholder:text-fg-3 focus-visible:ring-2 focus-visible:ring-focus @tablet:text-[2.125rem]"
    />
  );
}

function PageHead({ page, doc }: { page: PageMeta; doc: PageDoc | null }) {
  const editing = useShell((s) => s.editingTitle === page.id);
  const commands = useCommands();
  const queryClient = useQueryClient();
  const ui = useUiState();
  const favorite = isFavorite(ui.favorites ?? [], { type: 'page', id: page.id });
  const [converting, setConverting] = useState(false);
  const copyLink = () => {
    const url = `${location.origin}/p/${page.id}`;
    navigator.clipboard?.writeText(url).then(
      () => toast({ title: 'Link copied', tone: 'success' }),
      () => toast({ title: 'Couldn’t copy the link', description: url, tone: 'error' }),
    );
  };
  return (
    <div className="flex shrink-0 flex-col gap-2 px-4 pt-3.5 pb-2.5 @tablet:px-7 @tablet:pt-5.5 @tablet:pb-3.5 @wide:px-9">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <TitleEditor page={page} />
          ) : (
            <h1
              onClick={() => useShell.getState().setEditingTitle(page.id)}
              title="Click to rename"
              className={cn(
                'min-w-0 cursor-text truncate font-display text-[1.4375rem] leading-tight font-semibold tracking-[-0.03em] @tablet:text-[2.125rem]',
                !page.title && 'text-fg-3',
              )}
            >
              {page.title || 'Untitled page'}
            </h1>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <PageSaveIndicator page={page} doc={doc} />
          <IconButton
            label={favorite ? 'Remove from favourites' : 'Add to favourites'}
            icon={<Star className={cn(favorite && 'fill-current text-warn')} />}
            aria-pressed={favorite}
            onClick={() => toggleFavorite(queryClient, ui, { type: 'page', id: page.id })}
          />
          <Menu>
            <MenuTrigger asChild>
              <IconButton label="Page actions" icon={<Ellipsis />} />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem
                icon={<PenLine />}
                shortcut="F2"
                onSelect={() => useShell.getState().setEditingTitle(page.id)}
              >
                Rename
              </MenuItem>
              <MenuItem
                icon={<FilePlus />}
                shortcut={shortcutKeys('new-subpage')}
                onSelect={() => void commands.newPage({ subpage: true })}
              >
                New subpage
              </MenuItem>
              <MenuItem icon={<Link2 />} onSelect={copyLink}>
                Copy link
              </MenuItem>
              {page.type === 'markdown' ? (
                <MenuCheckboxItem
                  checked={!!ui.fullWidth?.includes(page.id)}
                  onCheckedChange={() => toggleFullWidth(queryClient, ui, page.id)}
                >
                  Full width
                </MenuCheckboxItem>
              ) : (
                // A rich page's text fills the pane, unless its edge was dragged.
                ui.pageWidths?.[page.id] && (
                  <MenuItem
                    icon={<MoveHorizontal />}
                    onSelect={() =>
                      saveUiState(queryClient, { pageWidths: { [page.id]: null } }, 0)
                    }
                  >
                    Fit the text to the pane
                  </MenuItem>
                )
              )}
              <MenuSeparator />
              <MenuItem
                icon={<FolderInput />}
                shortcut={shortcutKeys('move')}
                onSelect={() => commands.movePages([page.id])}
              >
                Move or copy…
              </MenuItem>
              <MenuItem icon={<Copy />} onSelect={() => commands.duplicatePage(page.id)}>
                Duplicate
              </MenuItem>
              <MenuItem icon={<Repeat />} disabled={!doc} onSelect={() => setConverting(true)}>
                {page.type === 'markdown' ? 'Convert to rich text…' : 'Convert to Markdown…'}
              </MenuItem>
              <MenuItem
                icon={<FileClock />}
                onSelect={() =>
                  useShell.getState().openDialog({ kind: 'history', pageId: page.id })
                }
              >
                History
              </MenuItem>
              <MenuItem
                icon={<Save />}
                onSelect={() =>
                  useShell.getState().openDialog({ kind: 'save-version', pageId: page.id })
                }
              >
                Save version…
              </MenuItem>
              <MenuItem
                icon={<LayoutTemplate />}
                disabled={!doc}
                onSelect={() =>
                  useShell.getState().openDialog({ kind: 'save-template', pageId: page.id })
                }
              >
                Save as template…
              </MenuItem>
              <MenuItem
                icon={<Share2 />}
                onSelect={() =>
                  useShell.getState().openDialog({ kind: 'export', scope: 'page', id: page.id })
                }
              >
                Export…
              </MenuItem>
              <MenuItem
                icon={<SquareKanban />}
                onSelect={() =>
                  useShell.getState().openDialog({ kind: 'add-to-board', pageId: page.id })
                }
              >
                Add to board…
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={<Trash2 />} danger onSelect={() => commands.deletePages([page.id])}>
                Delete page
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-3">
        <span title={formatDateTime(page.updatedAt)}>Edited {formatRelative(page.updatedAt)}</span>
        <span title={formatDateTime(page.createdAt)}>Created {formatDateTime(page.createdAt)}</span>
        <span>{page.type === 'markdown' ? 'Markdown' : 'Rich text'}</span>
        <PresenceHint pageId={page.id} />
        <PageTags page={page} />
      </div>
      <Dialog open={converting} onOpenChange={setConverting}>
        {converting && doc && (
          <ConvertDialog page={page} doc={doc} onDone={() => setConverting(false)} />
        )}
      </Dialog>
    </div>
  );
}

/** The main pane: section tabs, then the page (or an empty state). */
export function NotesPane() {
  const current = useCurrent();
  const { index, section, page, missing } = current;
  const commands = useCommands();
  const go = useGo();
  const doc = usePageDoc(page?.id ?? null);
  const sectionTemplates = useUiState().sectionTemplates;
  const templates = useTemplates();

  if (missing) {
    return (
      <EmptyState
        icon={<FileQuestion />}
        title="Not found"
        description="This page, section or notebook isn’t here. It may have been deleted or moved to the recycle bin."
        actions={
          <Button variant="primary" onClick={go.home}>
            Go to your notes
          </Button>
        }
      />
    );
  }

  if (!section || (index.notebooks.length === 0 && current.level === 'home')) {
    return (
      <EmptyState
        icon={<NotebookPen />}
        title="Welcome to your notes"
        description="Notebooks hold sections, and sections hold pages, like a binder with coloured tabs. Start with a notebook, or jot something down in your Inbox."
        actions={
          <>
            <Button variant="primary" onClick={commands.newNotebook}>
              <Plus /> New notebook
            </Button>
            <Button onClick={commands.quickNote}>
              <PenLine /> Quick note
            </Button>
          </>
        }
      />
    );
  }

  const defaultTemplate = templates.find((t) => t.id === sectionTemplates?.[section.id]);
  return (
    <section aria-label="Editor" className="flex h-full min-h-0 flex-col">
      <SectionBar panelId="page-panel" />
      <div
        id="page-panel"
        role="tabpanel"
        tabIndex={-1}
        aria-labelledby={`sectab-${section.id}`}
        className="flex min-h-0 flex-1 flex-col outline-none"
      >
        {page ? (
          <>
            <PageHead key={page.id} page={page} doc={doc} />
            <div className="min-h-0 flex-1">
              <PageBody key={page.id} page={page} doc={doc} />
            </div>
          </>
        ) : (
          <EmptyState
            icon={<FilePlus />}
            color={section.color}
            title={`No pages in ${section.name} yet`}
            description={
              defaultTemplate
                ? `New pages here start from the template “${defaultTemplate.name}”.`
                : 'Start with a blank page: write in Markdown, and it saves as you type.'
            }
            actions={
              <>
                <Button variant="primary" onClick={() => void commands.newPage()}>
                  <FilePlus /> New page
                </Button>
                <Button
                  onClick={() =>
                    pickTemplate(
                      (template) => void commands.newPage({ sectionId: section.id, template }),
                      'New page from a template',
                    )
                  }
                >
                  <LayoutTemplate /> From a template
                </Button>
              </>
            }
          />
        )}
      </div>
    </section>
  );
}
