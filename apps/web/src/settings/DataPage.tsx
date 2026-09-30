import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Share2 } from 'lucide-react';
import { lazy, Suspense, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Dialog, Field, PasswordInput, Select, toast } from '../components/ui';
import { errorMessage } from '../lib/api';
import { treeKey } from '../notes/keys';
import { useNotes } from '../notes/queries';
import { ARCHIVE_FILES, IMPORT_ACCEPT, PAGE_FILES, importPageFiles } from '../transfer/importFiles';
import { startImport } from '../transfer/jobs';
import { SettingsSection } from './SettingsLayout';

/* Import and export (§9.10, §9.16): everything out, and files in. */

const ExportDialog = lazy(() =>
  import('../transfer/ExportDialog').then((m) => ({ default: m.ExportDialog })),
);

const NEW = 'new';

export function DataPage() {
  const index = useNotes();
  const queryClient = useQueryClient();
  const [exporting, setExporting] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [target, setTarget] = useState(NEW);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const targetId = useId();

  const archives = files.filter((f) => ARCHIVE_FILES.test(f.name));
  const pages = files.filter((f) => PAGE_FILES.test(f.name));
  const unknown = files.filter((f) => !ARCHIVE_FILES.test(f.name) && !PAGE_FILES.test(f.name));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!files.length) return setError('Choose a file to import.');
    if (unknown.length) return setError(`Memora can’t import “${unknown[0]!.name}”.`);
    try {
      for (const file of archives) {
        setBusy(`Uploading ${file.name}…`);
        await startImport(file, {
          ...(target !== NEW ? { notebookId: target } : {}),
          ...(password ? { password } : {}),
        });
      }
      if (pages.length) {
        const result = await importPageFiles(pages, index.inbox.id, (done, total) =>
          setBusy(`Importing files: ${done} of ${total}`),
        );
        void queryClient.invalidateQueries({ queryKey: treeKey });
        if (result.pageIds.length) {
          toast({
            title: `Imported ${result.pageIds.length} ${result.pageIds.length === 1 ? 'page' : 'pages'} into the Inbox`,
            tone: 'success',
          });
        }
        if (result.failed.length) {
          setError(result.failed.map((f) => `${f.name}: ${f.reason}`).join(' '));
          setBusy(null);
          return;
        }
      }
      setFiles([]);
      setPassword('');
      if (input.current) input.current.value = '';
    } catch (err) {
      setError(errorMessage(err));
    }
    setBusy(null);
  };

  return (
    <>
      <SettingsSection
        title="Export"
        description="Download everything as a Memora archive, to keep or to move to another Memora, or as Markdown for other apps. Notebooks, sections and pages have their own “Export…” in their menus."
        actions={
          <Button onClick={() => setExporting(true)}>
            <Share2 aria-hidden />
            Export everything…
          </Button>
        }
      >
        <p className="text-sm text-fg-2">
          Exports are prepared on the server; you can keep working meanwhile, and the file downloads
          when it is ready. It stays available for a day.
        </p>
      </SettingsSection>
      <SettingsSection
        title="Import"
        description="Memora archives (.memora) and zips of Markdown files become notebooks. Markdown, text, Word and web pages become pages in your Inbox. You can also drop files onto a page list or a section tab."
      >
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={input}
              type="file"
              multiple
              accept={IMPORT_ACCEPT}
              aria-label="Files to import"
              className="sr-only"
              onChange={(e) => {
                setFiles([...(e.target.files ?? [])]);
                setError(null);
              }}
            />
            <Button onClick={() => input.current?.click()}>
              <FileUp aria-hidden />
              Choose files…
            </Button>
            <span className="text-sm text-fg-2">
              {files.length ? files.map((f) => f.name).join(', ') : 'No file chosen'}
            </span>
          </div>
          {archives.length > 0 && (
            <div className="grid gap-4 tablet:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={targetId} className="text-sm font-semibold">
                  Import into
                </label>
                <Select
                  id={targetId}
                  value={target}
                  onValueChange={setTarget}
                  options={[
                    { value: NEW, label: 'New notebooks' },
                    ...index.notebooks.map((n) => ({ value: n.id, label: n.name })),
                  ]}
                />
              </div>
              <Field label="Password" hint="Only for encrypted archives.">
                {({ id, describedBy }) => (
                  <PasswordInput
                    id={id}
                    aria-describedby={describedBy}
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
              {target !== NEW && (
                <p className="text-xs text-fg-3 tablet:col-span-2">
                  A backup is made first. Everything imported gets new ids, so nothing already there
                  is replaced.
                </p>
              )}
            </div>
          )}
          {busy && (
            <p role="status" className="text-sm text-fg-2">
              {busy}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div>
            <Button variant="primary" type="submit" disabled={!!busy || !files.length}>
              Import
            </Button>
          </div>
        </form>
      </SettingsSection>
      <Dialog open={exporting} onOpenChange={setExporting}>
        <Suspense fallback={null}>
          {exporting && <ExportDialog scope="everything" onClose={() => setExporting(false)} />}
        </Suspense>
      </Dialog>
    </>
  );
}
