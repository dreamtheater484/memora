import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JOB_FILE_HOURS,
  uuidv7,
  type ExportReport,
  type ImportReport,
  type Job,
} from '@memora/shared';
import type { EventHub } from '../events/hub';
import { notFound } from '../errors';

/*
 * Background jobs (§9.10): imports and exports run one at a time, so a large one can't take
 * all the memory, and report their progress to the user's browsers over the event channel.
 * An export's file is kept in the jobs folder for a day. Jobs live in memory; a restart
 * starts with an empty folder.
 */

export interface JobContext {
  /** A folder of the job's own, for its files. */
  dir: string;
  /** Reports progress (0–1); sent at most a few times a second. */
  progress(fraction: number, message: string): void;
}

export interface JobResult {
  /** The file to download (in the job's folder). */
  file?: { path: string; name: string };
  exportReport?: ExportReport;
  importReport?: ImportReport;
}

export type JobWork = (context: JobContext) => Promise<JobResult>;

interface Entry {
  job: Job;
  owner: string;
  file: string | null;
}

const FILE_MS = JOB_FILE_HOURS * 3_600_000;
/** Finished jobs listed, per user. */
const KEEP_FINISHED = 20;
const PROGRESS_EVERY_MS = 250;

export class JobService {
  private readonly jobs = new Map<string, Entry>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    /** Where jobs keep their files. */
    readonly dir: string,
    private readonly events: EventHub,
    private readonly now: () => number,
    private readonly onError: (error: unknown, job: Job) => void = () => undefined,
  ) {}

  /** Clears what a previous run left behind. */
  async prepare(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true });
  }

  start(owner: string, kind: Job['kind'], message: string, work: JobWork): Job {
    const job: Job = {
      id: uuidv7(this.now()),
      kind,
      state: 'queued',
      progress: 0,
      message,
      fileName: null,
      size: null,
      exportReport: null,
      importReport: null,
      error: null,
      createdAt: this.now(),
      finishedAt: null,
      expiresAt: null,
    };
    const entry: Entry = { job, owner, file: null };
    this.jobs.set(job.id, entry);
    this.trim(owner);
    this.chain = this.chain.then(() => this.run(entry, work));
    return { ...job };
  }

  /** Resolves when every job started so far has finished (for tests). */
  idle(): Promise<void> {
    return this.chain;
  }

  private async run(entry: Entry, work: JobWork) {
    const { job, owner } = entry;
    const dir = join(this.dir, job.id);
    let last = 0;
    const update = (patch: Partial<Job>, force = false) => {
      Object.assign(job, patch);
      if (!force && this.now() - last < PROGRESS_EVERY_MS) return;
      last = this.now();
      this.events.publish(owner, { type: 'job.updated', job: { ...job } });
    };
    update({ state: 'running' }, true);
    try {
      await mkdir(dir, { recursive: true });
      const result = await work({
        dir,
        progress: (fraction, message) =>
          update({ progress: Math.min(1, Math.max(0, fraction)), message }),
      });
      if (result.file) {
        entry.file = result.file.path;
        job.fileName = result.file.name;
        job.size = (await stat(result.file.path)).size;
        job.expiresAt = this.now() + FILE_MS;
      } else {
        await rm(dir, { recursive: true, force: true });
      }
      update(
        {
          state: 'done',
          progress: 1,
          message: 'Done',
          exportReport: result.exportReport ?? null,
          importReport: result.importReport ?? null,
          finishedAt: this.now(),
        },
        true,
      );
    } catch (error) {
      this.onError(error, job);
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      update(
        {
          state: 'failed',
          error: error instanceof Error ? error.message : 'Something went wrong.',
          finishedAt: this.now(),
        },
        true,
      );
    }
  }

  get(owner: string, id: string): Job {
    const entry = this.jobs.get(id);
    if (!entry || entry.owner !== owner) throw notFound('Job not found.');
    return { ...entry.job };
  }

  list(owner: string): Job[] {
    return [...this.jobs.values()]
      .filter((e) => e.owner === owner)
      .map((e) => ({ ...e.job }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** The finished export's file. */
  file(owner: string, id: string): { path: string; name: string } {
    const entry = this.jobs.get(id);
    if (!entry || entry.owner !== owner || !entry.file || !entry.job.fileName) {
      throw notFound('This file isn’t available any more.');
    }
    return { path: entry.file, name: entry.job.fileName };
  }

  /** Deletes the files of exports older than a day; answers how many. */
  async expire(): Promise<number> {
    let removed = 0;
    for (const [id, entry] of this.jobs) {
      if (entry.job.expiresAt !== null && entry.job.expiresAt <= this.now()) {
        await rm(join(this.dir, id), { recursive: true, force: true });
        this.jobs.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Keeps the list short: the oldest finished jobs without a file go first. */
  private trim(owner: string) {
    const finished = [...this.jobs.values()]
      .filter((e) => e.owner === owner && e.job.finishedAt !== null && !e.file)
      .sort((a, b) => a.job.createdAt - b.job.createdAt);
    for (const entry of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) {
      this.jobs.delete(entry.job.id);
    }
  }
}
