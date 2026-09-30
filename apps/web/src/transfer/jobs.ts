import type { ExportOptions, ExportRequest, Job } from '@memora/shared';
import { queryOptions } from '@tanstack/react-query';
import { create } from 'zustand';
import { api, postFile } from '../lib/api';

/*
 * Import and export jobs (§9.10). The server runs them in the background and reports their
 * progress over the event channel; the tab that started one follows it (checking now and then
 * too, in case the channel isn't there), downloads an export's file when it is ready and says
 * what an import brought in.
 */

interface JobsState {
  /** Jobs started here, newest last, until they are dismissed. */
  jobs: Job[];
  update: (job: Job) => void;
  dismiss: (id: string) => void;
}

export const useJobs = create<JobsState>()((set) => ({
  jobs: [],
  update: (job) =>
    set((s) => {
      const i = s.jobs.findIndex((j) => j.id === job.id);
      if (i < 0) return s;
      // Events can arrive out of order with the checks: never go back.
      const known = s.jobs[i]!;
      if (known.finishedAt !== null && job.finishedAt === null) return s;
      if (job.finishedAt === null && job.progress < known.progress) return s;
      const jobs = [...s.jobs];
      jobs[i] = job;
      return { jobs };
    }),
  dismiss: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
}));

/** An event from the server: only jobs started in this tab are shown. */
export function jobUpdated(job: Job): void {
  useJobs.getState().update(job);
}

const CHECK_MS = 1_500;

function follow(job: Job) {
  useJobs.setState((s) => ({ jobs: [...s.jobs, job] }));
  const check = async () => {
    const known = useJobs.getState().jobs.find((j) => j.id === job.id);
    if (!known || known.finishedAt !== null) return;
    try {
      jobUpdated(await api<Job>('GET', `/jobs/${job.id}`));
    } catch {
      // Tried again below.
    }
    setTimeout(() => void check(), CHECK_MS);
  };
  setTimeout(() => void check(), CHECK_MS);
}

export async function startExport(request: ExportRequest): Promise<Job> {
  const job = await api<Job>('POST', '/exports', request);
  follow(job);
  return job;
}

export async function startImport(
  file: File,
  options: { notebookId?: string; password?: string } = {},
): Promise<Job> {
  const query = new URLSearchParams({ name: file.name });
  if (options.notebookId) query.set('notebookId', options.notebookId);
  const job = await postFile<Job>(
    `/imports?${query.toString()}`,
    file,
    options.password ? { 'X-Memora-Archive-Password': options.password } : {},
  );
  follow(job);
  return job;
}

export const downloadUrl = (job: Job) => `/api/v1/jobs/${job.id}/download`;

/** Saves a file the browser has, under a name. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  saveUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function saveUrl(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

export const exportOptionsQuery = queryOptions({
  queryKey: ['exports', 'options'],
  queryFn: () => api<ExportOptions>('GET', '/exports/options'),
  staleTime: Infinity,
});
