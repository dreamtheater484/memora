import {
  RICH_LOSSES,
  type ContentSaved,
  type ConvertPageRequest,
  type PageMeta,
  type PageType,
  type RichLoss,
} from '@memora/shared';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, DialogContent, toast } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import type { PageDoc } from '../sync/doc';
import { currentSync } from '../sync/engine';

/*
 * Converting a page between Markdown and rich text (§9.4), from the page menu. The report says
 * beforehand what Markdown can't keep; the server keeps the page as it was as a version, so a
 * conversion can always be undone from the history.
 */

const LABEL: Record<PageType, string> = { markdown: 'Markdown', rich: 'rich text' };

async function convertContent(content: string, to: PageType) {
  const { markdownToRich, richToMarkdownPage } = await import('../rich/convert');
  if (to === 'rich') return { content: JSON.stringify(markdownToRich(content)), lost: [] };
  const { markdown, lost } = richToMarkdownPage(content);
  return { content: markdown, lost };
}

export function ConvertDialog({
  page,
  doc,
  onDone,
}: {
  page: PageMeta;
  doc: PageDoc;
  onDone: () => void;
}) {
  const from = doc.getSnapshot().record?.type ?? page.type;
  const to: PageType = from === 'markdown' ? 'rich' : 'markdown';
  const [lost, setLost] = useState<RichLoss[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void convertContent(doc.content(), to).then(
      (result) => live && setLost(result.lost),
      () => live && setLost([]),
    );
    return () => {
      live = false;
    };
  }, [doc, to]);

  const convert = async () => {
    setBusy(true);
    setError(null);
    try {
      await doc.flush();
      const record = await doc.whenSaved();
      if (!record) {
        throw new Error(
          'The page’s latest changes haven’t reached the server yet. Converting needs a connection: try again in a moment.',
        );
      }
      const { content } = await convertContent(record.content, to);
      const result = await api<ContentSaved>('POST', `/pages/${page.id}/convert`, {
        type: to,
        content,
        baseRevision: record.revision,
      } satisfies ConvertPageRequest);
      await doc.refresh();
      currentSync()?.applyTree({ pages: result.pages });
      toast({ title: `Converted to ${LABEL[to]}`, tone: 'success' });
      onDone();
    } catch (e) {
      setError(e instanceof Error && !('status' in e) ? e.message : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent
      title={`Convert to ${LABEL[to]}`}
      description={
        to === 'rich'
          ? 'The page becomes a rich text page, with a toolbar like a word processor’s. Nothing is lost.'
          : 'The page becomes a Markdown page: plain text with formatting marks.'
      }
      footer={
        <>
          <Button onClick={onDone} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void convert()} disabled={busy || !lost}>
            {busy ? 'Converting…' : 'Convert'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        {to === 'markdown' && lost && lost.length > 0 && (
          <div className="rounded-md border border-warn/45 bg-warn/10 px-3.5 py-3">
            <p className="flex items-center gap-2 font-semibold">
              <TriangleAlert aria-hidden className="size-4 text-warn" />
              Markdown can’t keep everything on this page:
            </p>
            <ul className="mt-2 list-disc pl-6 text-fg-2">
              {lost.map((loss) => (
                <li key={loss}>{RICH_LOSSES[loss]}</li>
              ))}
            </ul>
          </div>
        )}
        {to === 'markdown' && lost?.length === 0 && (
          <p className="text-fg-2">Everything on this page can be written in Markdown.</p>
        )}
        <p className="text-fg-2">
          The page as it is now is kept in its history, so you can go back to it.
        </p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
    </DialogContent>
  );
}
