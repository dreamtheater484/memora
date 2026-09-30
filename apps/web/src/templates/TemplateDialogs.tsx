import { MAX_TEMPLATE_LENGTH, type Template } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Ellipsis, FilePlus, LayoutTemplate, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  Button,
  DialogContent,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  toast,
} from '../components/ui';
import { errorMessage } from '../lib/api';
import { flushUiState, saveUiState, useNotes, useUiState } from '../notes/queries';
import { deleteTemplate, saveTemplate, updateTemplate } from '../search/api';
import { useShell } from '../shell/store';
import { usePageDoc } from '../sync/hooks';
import { useTemplates } from './templates';

/* Saving a page as a template, managing templates, and picking one to insert (§9.9). */

const close = () => useShell.getState().closeDialog();

const TYPE = { markdown: 'Markdown', rich: 'Rich text' } as const;

export function SaveTemplateDialog({ pageId }: { pageId: string }) {
  const index = useNotes();
  const queryClient = useQueryClient();
  const doc = usePageDoc(pageId);
  const page = index.page.get(pageId);
  const [name, setName] = useState(page?.title ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const record = doc?.getSnapshot().record;
    if (!record || !name.trim()) {
      setError(name.trim() ? 'The page isn’t loaded yet.' : 'Enter a name.');
      return;
    }
    if (record.content.length > MAX_TEMPLATE_LENGTH) {
      setError('This page is too long to be a template.');
      return;
    }
    setBusy(true);
    try {
      await saveTemplate(queryClient, { name, type: record.type, content: record.content });
      close();
      toast({
        title: 'Saved as a template',
        description: 'Start a page from it with ▾ beside “+ Page”, or from a section’s menu.',
        tone: 'success',
      });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <DialogContent
      size="sm"
      title="Save as template"
      description="New pages can start from this page’s content. {{date}}, {{time}} and {{title}} are filled in."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="save-template" disabled={busy}>
            Save template
          </Button>
        </>
      }
    >
      <form id="save-template" onSubmit={(e) => void submit(e)}>
        <Field label="Name" error={error}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              maxLength={100}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
      </form>
    </DialogContent>
  );
}

function TemplateRow({ template }: { template: Template }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(template.name);
  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      toast({ title: errorMessage(error), tone: 'error' });
    }
  };
  return (
    <li className="flex items-center gap-3 py-2">
      <LayoutTemplate aria-hidden className="size-4 shrink-0 text-fg-3" />
      {renaming ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setRenaming(false);
            if (name.trim() && name.trim() !== template.name) {
              void act(() => updateTemplate(queryClient, template.id, { name }));
            }
          }}
        >
          <Input
            aria-label="Template name"
            value={name}
            autoFocus
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            wrapperClassName="flex-1"
          />
          <Button size="sm" type="submit">
            Save
          </Button>
        </form>
      ) : (
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-medium">{template.name}</span>
          <span className="text-fg-3">
            {' '}
            · {template.builtIn ? 'Built in' : TYPE[template.type]}
          </span>
        </span>
      )}
      {!template.builtIn && !renaming && (
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={`“${template.name}” options`} icon={<Ellipsis />} size="sm" />
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<Pencil />} onSelect={() => setRenaming(true)}>
              Rename
            </MenuItem>
            <MenuItem
              icon={<Trash2 />}
              danger
              onSelect={() => void act(() => deleteTemplate(queryClient, template.id))}
            >
              Delete
            </MenuItem>
          </MenuContent>
        </Menu>
      )}
    </li>
  );
}

export function TemplatesDialog() {
  const templates = useTemplates();
  return (
    <DialogContent title="Templates" description="Pages can start from one of these.">
      <ul className="mb-3 flex list-disc flex-col gap-1 pl-5 text-sm text-fg-2">
        <li>
          <strong className="font-medium text-fg">A new page from one:</strong> ▾ beside “+ Page”,
          “From a template” in an empty section, or a section’s right-click menu.
        </li>
        <li>
          <strong className="font-medium text-fg">A section’s default:</strong> “Default template…”
          in the same menus. Every new page in that section starts from it.
        </li>
        <li>
          <strong className="font-medium text-fg">Into a page:</strong> type /template.
        </li>
        <li>
          <strong className="font-medium text-fg">Your own:</strong> “Save as template…” in a page’s
          ⋯ menu.
        </li>
      </ul>
      <ul aria-label="Templates" className="divide-y divide-line">
        {templates.map((t) => (
          <TemplateRow key={t.id} template={t} />
        ))}
      </ul>
    </DialogContent>
  );
}

export function InsertTemplateDialog({
  onPick,
  title = 'Insert a template',
}: {
  onPick: (template: Template) => void;
  title?: string;
}) {
  const templates = useTemplates();
  return (
    <DialogContent size="sm" title={title}>
      <ul aria-label="Templates" className="flex flex-col gap-px">
        {templates.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              onClick={() => {
                close();
                onPick(t);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-hover"
            >
              <LayoutTemplate aria-hidden className="size-4 shrink-0 text-fg-3" />
              <span className="min-w-0 truncate font-medium">{t.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </DialogContent>
  );
}

/** The template a section's new pages start from, or none (§9.9). Choosing one saves it. */
export function SectionTemplateDialog({ sectionId }: { sectionId: string }) {
  const index = useNotes();
  const queryClient = useQueryClient();
  const templates = useTemplates();
  const chosen = useUiState().sectionTemplates?.[sectionId] ?? null;
  const name = index.section.get(sectionId)?.name ?? 'this section';
  const choose = (template: Template | null) => {
    saveUiState(queryClient, { sectionTemplates: { [sectionId]: template?.id ?? null } });
    flushUiState();
    close();
    toast({
      title: template
        ? `New pages in ${name} start from “${template.name}”`
        : `New pages in ${name} start blank`,
      tone: 'success',
    });
  };
  const options: { template: Template | null; label: string }[] = [
    { template: null, label: 'Blank page' },
    ...templates.map((template) => ({ template, label: template.name })),
  ];
  return (
    <DialogContent
      size="sm"
      title="Default template"
      description={`Every new page in “${name}” starts from this.`}
    >
      <ul aria-label="Templates" className="flex flex-col gap-px">
        {options.map(({ template, label }) => {
          const current = (template?.id ?? null) === chosen;
          return (
            <li key={template?.id ?? 'blank'}>
              <button
                type="button"
                aria-current={current || undefined}
                onClick={() => choose(template)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-hover"
              >
                {template ? (
                  <LayoutTemplate aria-hidden className="size-4 shrink-0 text-fg-3" />
                ) : (
                  <FilePlus aria-hidden className="size-4 shrink-0 text-fg-3" />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                {current && (
                  <span className="flex items-center gap-1 text-xs text-fg-3">
                    <Check aria-hidden className="size-3.5" /> Current
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </DialogContent>
  );
}
