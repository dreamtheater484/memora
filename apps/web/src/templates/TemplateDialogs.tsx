import { MAX_TEMPLATE_LENGTH, type Template } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Ellipsis, LayoutTemplate, Pencil, Trash2 } from 'lucide-react';
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
import { useNotes } from '../notes/queries';
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
        description: 'Find it in the “New page” menu.',
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
    <DialogContent
      title="Templates"
      description="New pages can start from one: pick it in the “New page” menu, set one as a section’s default, or type /template in a page. Save any page as a template from its menu."
    >
      <ul aria-label="Templates" className="divide-y divide-line">
        {templates.map((t) => (
          <TemplateRow key={t.id} template={t} />
        ))}
      </ul>
    </DialogContent>
  );
}

export function InsertTemplateDialog({ onPick }: { onPick: (template: Template) => void }) {
  const templates = useTemplates();
  return (
    <DialogContent size="sm" title="Insert a template">
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
