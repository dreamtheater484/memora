import { assetPath, safeFileName, type ExportScope } from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Button, Checkbox, DialogContent, Field, PasswordInput, toast } from '../components/ui';
import { apiBlob, errorMessage } from '../lib/api';
import { useNotes } from '../notes/queries';
import { useShell } from '../shell/store';
import { bodyHtml, htmlFile, loadDocument, type ExportDocument } from './document';
import { exportOptionsQuery, saveBlob, startExport } from './jobs';
import { pagedScript, printHtml } from './print';

/* Exporting a page, section, group, notebook or everything (§9.10). */

const close = () => useShell.getState().closeDialog();

type Format = 'memora' | 'markdown' | 'docx' | 'html' | 'pdf';

const FORMATS: Record<Format, { label: string; hint: (scope: ExportScope) => string }> = {
  memora: {
    label: 'Memora archive (.memora)',
    hint: () =>
      'Everything, to import into Memora again: pages, files, tags and optionally history.',
  },
  markdown: {
    label: 'Markdown',
    hint: (scope) =>
      scope === 'page'
        ? 'A .md file (a .zip with its files and subpages), for other note apps.'
        : 'A .zip of folders and .md files, for other note apps.',
  },
  docx: {
    label: 'Word document (.docx)',
    hint: () => 'Opens in Word, LibreOffice and Google Docs.',
  },
  html: {
    label: 'Web page (.html)',
    hint: () => 'One file with the images inside, for any browser.',
  },
  pdf: { label: 'PDF', hint: () => 'Print it, or save it as a PDF.' },
};

const FORMATS_FOR: Record<ExportScope, Format[]> = {
  page: ['pdf', 'docx', 'markdown', 'html', 'memora'],
  section: ['pdf', 'docx', 'markdown', 'html', 'memora'],
  group: ['memora', 'markdown'],
  notebook: ['memora', 'markdown'],
  everything: ['memora', 'markdown'],
};

export function ExportDialog({
  scope,
  id,
  onClose = close,
}: {
  scope: ExportScope;
  id?: string;
  /** Outside the notes (settings), the dialog is the page's own. */
  onClose?: () => void;
}) {
  const index = useNotes();
  const formats = FORMATS_FOR[scope];
  const [format, setFormat] = useState<Format>(formats[0]!);
  const [history, setHistory] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const what =
    scope === 'everything'
      ? 'everything'
      : scope === 'page'
        ? `“${index.page.get(id!)?.title || 'Untitled page'}”`
        : scope === 'section'
          ? `“${index.section.get(id!)?.name ?? ''}”`
          : scope === 'group'
            ? `“${index.group.get(id!)?.name ?? ''}”`
            : `“${index.notebook.get(id!)?.name ?? ''}”`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (format === 'memora' && encrypt) {
      if (password.length < 8) return setError('Use at least 8 characters.');
      if (password !== again) return setError('The passwords don’t match.');
    }
    if (format === 'memora' || format === 'markdown') {
      try {
        setBusy('Starting…');
        await startExport({
          format,
          scope,
          id,
          history: format === 'memora' && history,
          ...(format === 'memora' && encrypt ? { password } : {}),
        });
        onClose();
      } catch (err) {
        setError(errorMessage(err));
        setBusy(null);
      }
      return;
    }
    if (format === 'pdf') {
      useShell
        .getState()
        .openDialog({ kind: 'print', scope: scope as 'page' | 'section', id: id! });
      return;
    }
    try {
      const document = await loadDocument(index, scope as 'page' | 'section', id!, (done, total) =>
        setBusy(total > 1 ? `Reading pages: ${done} of ${total}` : 'Reading the page…'),
      );
      setBusy('Writing the file…');
      const name = safeFileName(document.title, 'Memora');
      if (format === 'html') {
        saveBlob(await htmlFile(document), `${name}.html`);
      } else {
        const { docxFile } = await import('./docx');
        saveBlob(await docxFile(document), `${name}.docx`);
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <DialogContent
      title="Export"
      description={`Export ${what} as:`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="export" disabled={!!busy}>
            {format === 'pdf' ? 'Preview…' : 'Export'}
          </Button>
        </>
      }
    >
      <form id="export" className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Format</legend>
          {formats.map((f) => (
            <label
              key={f}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 hover:bg-hover has-checked:bg-accent-soft"
            >
              <input
                type="radio"
                name="format"
                value={f}
                checked={format === f}
                aria-labelledby={`export-${f}`}
                aria-describedby={`export-${f}-hint`}
                onChange={() => {
                  setFormat(f);
                  setError(null);
                }}
                className="mt-1 accent-(--accent)"
              />
              <span className="flex flex-col">
                <span id={`export-${f}`} className="text-sm font-semibold">
                  {FORMATS[f].label}
                </span>
                <span id={`export-${f}-hint`} className="text-xs text-fg-3">
                  {FORMATS[f].hint(scope)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        {format === 'memora' && (
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={history} onCheckedChange={(v) => setHistory(v === true)} />
              Include version history
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={encrypt} onCheckedChange={(v) => setEncrypt(v === true)} />
              Encrypt with a password
            </label>
            {encrypt && (
              <div className="grid gap-3 tablet:grid-cols-2">
                <Field label="Password">
                  {({ id: field, describedBy }) => (
                    <PasswordInput
                      id={field}
                      aria-describedby={describedBy}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Password again">
                  {({ id: field, describedBy }) => (
                    <PasswordInput
                      id={field}
                      aria-describedby={describedBy}
                      autoComplete="new-password"
                      value={again}
                      onChange={(e) => setAgain(e.target.value)}
                    />
                  )}
                </Field>
                <p className="text-xs text-fg-3 tablet:col-span-2">
                  Without the password the archive can’t be opened: Memora can’t recover it.
                </p>
              </div>
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
      </form>
    </DialogContent>
  );
}

/** Checks in a row with the same page count before the preview counts as laid out. */
const SETTLED_CHECKS = 3;

/** A print preview laid out in pages (Paged.js), to print or save as a PDF. */
export function PrintDialog({ scope, id }: { scope: 'page' | 'section'; id: string }) {
  const index = useNotes();
  const options = useQuery(exportOptionsQuery);
  const [document, setDocument] = useState<ExportDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let live = true;
    loadDocument(index, scope, id).then(
      (loaded) => live && setDocument(loaded),
      (err: unknown) => live && setError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
    // Loaded once, as the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const srcDoc = useMemo(
    () =>
      document &&
      printHtml(
        document.title,
        bodyHtml(document, (asset) => assetPath(asset)),
        pagedScript,
      ),
    [document],
  );

  // Paged.js lays the pages out in the frame; printing waits until it is done.
  useEffect(() => {
    if (!srcDoc) return;
    let last = -1;
    let same = 0;
    const timer = setInterval(() => {
      const count = frame.current?.contentDocument?.querySelectorAll('.pagedjs_page').length ?? 0;
      if (count !== last) {
        last = count;
        same = 0;
        setPages(count);
      } else if (count > 0 && (same += 1) >= SETTLED_CHECKS) {
        setReady(true);
        clearInterval(timer);
      }
    }, 150);
    return () => clearInterval(timer);
  }, [srcDoc]);

  const downloadPdf = async () => {
    if (!document) return;
    setSaving(true);
    try {
      const html = printHtml(
        document.title,
        bodyHtml(document, (asset) => `asset:${asset}`),
        null,
      );
      const name = safeFileName(document.title, 'Memora');
      saveBlob(await apiBlob('POST', '/exports/pdf', { name, html }), `${name}.pdf`);
    } catch (err) {
      toast({ title: errorMessage(err), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent
      size="xl"
      title="Print or save as PDF"
      description={
        ready
          ? `${pages} ${pages === 1 ? 'page' : 'pages'}. To save a PDF, choose “Save as PDF” as the printer.`
          : 'Laying out the pages…'
      }
      footer={
        <>
          <Button onClick={close}>Close</Button>
          {options.data?.pdf && (
            <Button disabled={!document || saving} onClick={() => void downloadPdf()}>
              {saving ? 'Making the PDF…' : 'Download PDF'}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!ready}
            onClick={() => frame.current?.contentWindow?.print()}
          >
            Print…
          </Button>
        </>
      }
    >
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        srcDoc && (
          <iframe
            ref={frame}
            title="Print preview"
            srcDoc={srcDoc}
            className="h-[60dvh] w-full rounded-lg border border-line bg-[#e9ebee]"
          />
        )
      )}
    </DialogContent>
  );
}
