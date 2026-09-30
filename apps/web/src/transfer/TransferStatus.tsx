import type { Job } from '@memora/shared';
import { useNavigate } from '@tanstack/react-router';
import { Download, FileDown, FileUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '../components/ui';
import { formatBytes } from '../lib/bytes';
import { downloadUrl, saveUrl, useJobs } from './jobs';

/*
 * Imports and exports under way, bottom left (§9.10): progress while they run, then the
 * export's file (downloaded straight away) or what the import brought in.
 */

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function summary(job: Job): string {
  const report = job.importReport;
  if (!report) return '';
  const parts = [
    report.notebooks && plural(report.notebooks, 'notebook'),
    report.sections && plural(report.sections, 'section'),
    plural(report.pages, 'page'),
    report.files && plural(report.files, 'file'),
    report.templates && plural(report.templates, 'template'),
  ].filter(Boolean);
  return parts.join(', ');
}

function JobCard({ job }: { job: Job }) {
  const navigate = useNavigate();
  const dismiss = () => useJobs.getState().dismiss(job.id);
  const [details, setDetails] = useState(false);
  const exporting = job.kind === 'export';
  const running = job.finishedAt === null;
  // The file the user asked for downloads as soon as it is ready.
  const saved = useRef(false);
  useEffect(() => {
    if (exporting && job.state === 'done' && job.fileName && !saved.current) {
      saved.current = true;
      saveUrl(downloadUrl(job), job.fileName);
    }
  }, [exporting, job]);

  const title = running
    ? exporting
      ? 'Exporting…'
      : 'Importing…'
    : job.state === 'failed'
      ? exporting
        ? 'Export failed'
        : 'Import failed'
      : exporting
        ? 'Export ready'
        : 'Import finished';
  const skipped = job.importReport?.skipped ?? [];
  const lost = job.exportReport?.lost ?? [];

  return (
    <li
      className="glass-raised flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl p-3 shadow-lg"
      aria-label={title}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-fg-3 [&_svg]:size-4">
          {exporting ? <FileDown aria-hidden /> : <FileUp aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="truncate text-xs text-fg-3">
            {running
              ? job.message
              : job.state === 'failed'
                ? job.error
                : exporting
                  ? `${job.fileName ?? ''}${job.size !== null ? ` · ${formatBytes(job.size)}` : ''}`
                  : summary(job)}
          </p>
        </div>
        {!running && <IconButton label="Close" icon={<X />} size="xs" onClick={dismiss} />}
      </div>
      {running && (
        <div
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(job.progress * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-line"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${Math.max(4, job.progress * 100)}%` }}
          />
        </div>
      )}
      {!running && job.state === 'done' && (
        <div className="flex flex-wrap justify-end gap-2">
          {(skipped.length > 0 || lost.length > 0) && (
            <Button size="sm" variant="ghost" onClick={() => setDetails(!details)}>
              {details
                ? 'Hide details'
                : skipped.length
                  ? `${skipped.length} skipped`
                  : 'What changed'}
            </Button>
          )}
          {exporting && job.fileName && (
            <Button size="sm" onClick={() => saveUrl(downloadUrl(job), job.fileName!)}>
              <Download aria-hidden />
              Download again
            </Button>
          )}
          {!exporting && job.importReport?.firstPageId && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                dismiss();
                void navigate({
                  to: '/p/$pageId',
                  params: { pageId: job.importReport!.firstPageId! },
                });
              }}
            >
              Open
            </Button>
          )}
        </div>
      )}
      {details && (
        <ul className="max-h-40 overflow-auto text-xs text-fg-2">
          {skipped.map((s, i) => (
            <li key={`s${i}`}>
              <span className="font-semibold">{s.name}</span>: {s.reason}
            </li>
          ))}
          {lost.map((l, i) => (
            <li key={`l${i}`}>
              <span className="font-semibold">{l.title}</span>: Markdown can’t keep{' '}
              {l.lost.join(', ')}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function TransferStatus() {
  const jobs = useJobs((s) => s.jobs);
  if (!jobs.length) return null;
  return (
    <section aria-label="Imports and exports" className="fixed bottom-4 left-4 z-40">
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </ul>
    </section>
  );
}
