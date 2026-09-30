import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  COLOR_IDS,
  MAX_GROUP_DEPTH,
  MAX_PAGE_DEPTH,
  NOTEBOOK_ICONS,
  isRichContent,
  keysBetween,
  markdownToText,
  pickColor,
  readFrontMatter,
  richToText,
  tagKey,
  uuidv7,
  type ImportReport,
  type PageType,
} from '@memora/shared';
import { z } from 'zod';
import type { AssetsService } from '../assets/service';
import { EnvelopeError, decryptFile, isEncrypted } from '../backup/envelope';
import type { SqliteDatabase } from '../db/client';
import { ApiError } from '../errors';
import { indexPageLinks } from '../notes/links';
import type { JobContext } from './jobs';
import { boardFileSchema, importKanban, projectFileSchema, type ProjectFile } from './kanban';
import { ZipLimitError, readZip, sha256, type ZipEntry, type ZipLimits } from './zip';

/*
 * Imports (§9.10): `.memora` archives (checked against their manifest) and Markdown folders
 * in a zip. Everything gets new ids, so an import never clashes with what is there; it goes
 * into new notebooks, or into a chosen notebook. Files are stored first, one at a time; the
 * notes then go in in one transaction, so a failed import leaves nothing half done.
 */

export interface ImportDeps {
  db: SqliteDatabase;
  assets: AssetsService;
  now: () => number;
  limits: ZipLimits;
}

export interface ImportTarget {
  owner: string;
  /** Pages from another inbox go into this one. */
  inboxId: string;
  /** Merge into this notebook; new notebooks otherwise. */
  notebookId?: string;
}

const fail = (message: string) => new ApiError(422, 'invalid_request', message);

// Archive files, read leniently: what Memora needs, with the rest ignored.

const notebookFile = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().optional(),
  icon: z.string().optional(),
  sortKey: z.string().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
const groupFile = z.object({
  id: z.string(),
  notebookId: z.string(),
  parentGroupId: z.string().nullable().optional(),
  name: z.string(),
  sortKey: z.string().optional(),
});
const sectionFile = z.object({
  id: z.string(),
  notebookId: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  name: z.string(),
  color: z.string().optional(),
  sortKey: z.string().optional(),
  isInbox: z.boolean().optional(),
});
const pageFile = z.object({
  id: z.string(),
  sectionId: z.string(),
  parentPageId: z.string().nullable().optional(),
  title: z.string(),
  type: z.enum(['markdown', 'rich']),
  sortKey: z.string().optional(),
  viewMode: z.enum(['source', 'split', 'preview']).nullable().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  tags: z.array(z.string()).optional(),
});
const assetIndex = z.array(
  z.object({ id: z.string(), mime: z.string(), name: z.string(), file: z.string() }),
);
const tagsFile = z.array(z.object({ name: z.string(), color: z.string().nullable().optional() }));
const templateFile = z.object({
  name: z.string(),
  type: z.enum(['markdown', 'rich']),
  content: z.string(),
});
const versionLine = z.object({
  revision: z.number(),
  type: z.enum(['markdown', 'rich']),
  title: z.string(),
  content: z.string(),
  reason: z.enum(['auto', 'conversion', 'import', 'restore', 'conflict', 'manual']),
  name: z.string().nullable().optional(),
  deviceLabel: z.string().optional(),
  createdAt: z.number(),
});

const textOf = (type: PageType, content: string) =>
  type === 'markdown' ? markdownToText(content) : richToText(content);

const clip = (text: string, max: number) => text.trim().slice(0, max);

/**
 * Pages' text waits on disk until it goes in, so a large import holds one page at a time
 * rather than all of them.
 */
class Spill {
  private count = 0;

  constructor(private readonly dir: string) {}

  async put(text: string | Buffer): Promise<string> {
    if (this.count === 0) await mkdir(this.dir, { recursive: true });
    const path = join(this.dir, String((this.count += 1)));
    await writeFile(path, text);
    return path;
  }

  read(path: string): string {
    return readFileSync(path, 'utf8');
  }
}

/**
 * Where things go and in what order: each parent's new children follow what it has already,
 * in the order they come.
 */
class Builder {
  readonly report: ImportReport = {
    notebooks: 0,
    sections: 0,
    pages: 0,
    files: 0,
    templates: 0,
    skipped: [],
    firstPageId: null,
  };
  private readonly last = new Map<string, string | null>();
  private readonly tagIds = new Map<string, string>();
  private readonly colors = new Map<string, string[]>();

  constructor(
    private readonly db: SqliteDatabase,
    private readonly owner: string,
    private readonly now: number,
  ) {
    for (const row of db
      .prepare('SELECT id, name_key AS key FROM tags WHERE owner_id = ?')
      .all(owner) as { id: string; key: string }[]) {
      this.tagIds.set(row.key, row.id);
    }
  }

  private nextKey(parent: string, query: () => string | null): string {
    if (!this.last.has(parent)) this.last.set(parent, query());
    const [key] = keysBetween(this.last.get(parent)!, null, 1);
    this.last.set(parent, key!);
    return key!;
  }

  private maxKey(sql: string, ...args: unknown[]): string | null {
    const row = this.db.prepare(sql).get(...args) as { key: string | null } | undefined;
    return row?.key ?? null;
  }

  liveNotebook(id: string): void {
    const row = this.db
      .prepare('SELECT id FROM notebooks WHERE id = ? AND owner_id = ? AND deleted_at IS NULL')
      .get(id, this.owner);
    if (!row) throw new ApiError(404, 'not_found', 'Notebook not found.');
  }

  notebook(name: string, color: string | undefined, icon: string | undefined): string {
    const id = uuidv7(this.now);
    const key = this.nextKey('notebooks', () =>
      this.maxKey(
        'SELECT max(sort_key) AS key FROM notebooks WHERE owner_id = ? AND deleted_at IS NULL',
        this.owner,
      ),
    );
    this.db
      .prepare(
        `INSERT INTO notebooks (id, owner_id, name, color, icon, sort_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.owner,
        clip(name, 100) || 'Imported',
        COLOR_IDS.includes(color as never) ? color : 'blue',
        NOTEBOOK_ICONS.includes(icon as never) ? icon : 'notebook',
        key,
        this.now,
        this.now,
      );
    this.report.notebooks += 1;
    return id;
  }

  group(notebookId: string, parentGroupId: string | null, name: string): string {
    const id = uuidv7(this.now);
    const key = this.nextKey(`g:${notebookId}:${parentGroupId}`, () =>
      this.maxKey(
        `SELECT max(sort_key) AS key FROM section_groups WHERE notebook_id = ? AND parent_group_id IS ?
         AND deleted_at IS NULL`,
        notebookId,
        parentGroupId,
      ),
    );
    this.db
      .prepare(
        `INSERT INTO section_groups (id, owner_id, notebook_id, parent_group_id, name, sort_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.owner,
        notebookId,
        parentGroupId,
        clip(name, 100) || 'Group',
        key,
        this.now,
        this.now,
      );
    return id;
  }

  section(notebookId: string, groupId: string | null, name: string, color?: string): string {
    const id = uuidv7(this.now);
    const key = this.nextKey(`s:${notebookId}:${groupId}`, () =>
      this.maxKey(
        `SELECT max(sort_key) AS key FROM sections WHERE notebook_id = ? AND group_id IS ? AND deleted_at IS NULL`,
        notebookId,
        groupId,
      ),
    );
    let used = this.colors.get(notebookId);
    if (!used) {
      used = (
        this.db
          .prepare('SELECT color FROM sections WHERE notebook_id = ? AND deleted_at IS NULL')
          .all(notebookId) as { color: string }[]
      ).map((r) => r.color);
      this.colors.set(notebookId, used);
    }
    const chosen = COLOR_IDS.includes(color as never) ? color! : pickColor(used);
    used.push(chosen);
    this.db
      .prepare(
        `INSERT INTO sections (id, owner_id, notebook_id, group_id, name, color, sort_key, is_inbox, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        id,
        this.owner,
        notebookId,
        groupId,
        clip(name, 100) || 'Section',
        chosen,
        key,
        this.now,
        this.now,
      );
    this.report.sections += 1;
    return id;
  }

  page(input: {
    sectionId: string;
    parentPageId: string | null;
    title: string;
    type: PageType;
    content: string;
    viewMode?: string | null;
    createdAt?: number;
    updatedAt?: number;
    tags?: { name: string; color?: string | null }[];
  }): string | null {
    if (input.type === 'rich' && !isRichContent(input.content)) {
      this.report.skipped.push({
        name: input.title || 'Untitled page',
        reason: 'Its content is damaged.',
      });
      return null;
    }
    const id = uuidv7(this.now);
    const key = this.nextKey(`p:${input.sectionId}:${input.parentPageId}`, () =>
      this.maxKey(
        `SELECT max(sort_key) AS key FROM pages WHERE section_id = ? AND parent_page_id IS ? AND deleted_at IS NULL`,
        input.sectionId,
        input.parentPageId,
      ),
    );
    this.db
      .prepare(
        `INSERT INTO pages (id, owner_id, section_id, parent_page_id, title, type, content, content_text,
           revision, sort_key, view_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
      )
      .run(
        id,
        this.owner,
        input.sectionId,
        input.parentPageId,
        clip(input.title, 200),
        input.type,
        input.content,
        textOf(input.type, input.content),
        key,
        input.viewMode ?? null,
        input.createdAt ?? this.now,
        input.updatedAt ?? this.now,
      );
    indexPageLinks(this.db, id, input.type, input.content);
    for (const tag of input.tags ?? []) this.tag(id, tag.name, tag.color ?? null);
    this.report.pages += 1;
    this.report.firstPageId ??= id;
    return id;
  }

  private tag(pageId: string, name: string, color: string | null) {
    const clean = name.replace(/[",]/g, '').trim().slice(0, 40);
    if (!clean) return;
    const key = tagKey(clean);
    let id = this.tagIds.get(key);
    if (!id) {
      id = uuidv7(this.now);
      this.db
        .prepare(
          'INSERT INTO tags (id, owner_id, name, name_key, color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          this.owner,
          clean,
          key,
          COLOR_IDS.includes(color as never) ? color : null,
          this.now,
        );
      this.tagIds.set(key, id);
    }
    this.db
      .prepare('INSERT OR IGNORE INTO page_tags (page_id, tag_id) VALUES (?, ?)')
      .run(pageId, id);
  }
}

/** Reads an entry as JSON with a schema; null (and a note in the report) when it can't be. */
async function readJson<T>(
  entry: ZipEntry | undefined,
  schema: z.ZodType<T>,
  report: ImportReport,
  verify?: (path: string, data: Buffer) => void,
): Promise<T | null> {
  if (!entry) return null;
  const data = await entry.read();
  verify?.(entry.path, data);
  try {
    const parsed = schema.safeParse(JSON.parse(data.toString('utf8')));
    if (parsed.success) return parsed.data;
  } catch {
    // Reported below.
  }
  report.skipped.push({ name: entry.path, reason: 'It isn’t valid.' });
  return null;
}

export async function importFile(
  deps: ImportDeps,
  file: { path: string; name: string },
  target: ImportTarget,
  password: string | undefined,
  context: JobContext,
): Promise<ImportReport> {
  let path = file.path;
  if (await isEncrypted(path)) {
    if (!password) throw fail('This file is encrypted: enter its password.');
    const decrypted = join(context.dir, 'decrypted.zip');
    await decryptFile(path, decrypted, password).catch((error: unknown) => {
      throw error instanceof EnvelopeError ? fail(error.message) : error;
    });
    path = decrypted;
  }
  let zip: Awaited<ReturnType<typeof readZip>>;
  try {
    zip = await readZip(path, deps.limits);
  } catch (error) {
    if (error instanceof ZipLimitError) throw fail(error.message);
    throw fail('This isn’t a .memora file or a zip of Markdown files.');
  }
  try {
    const byPath = new Map(zip.entries.map((e) => [e.path, e]));
    return byPath.has('manifest.json')
      ? await importArchive(deps, byPath, target, context)
      : await importMarkdownFolder(deps, zip.entries, file.name, target, context);
  } catch (error) {
    if (error instanceof ZipLimitError) throw fail(error.message);
    throw error;
  } finally {
    zip.close();
  }
}

async function importArchive(
  deps: ImportDeps,
  byPath: Map<string, ZipEntry>,
  target: ImportTarget,
  context: JobContext,
): Promise<ImportReport> {
  const { db, owner } = { db: deps.db, owner: target.owner };
  const skipped: ImportReport['skipped'] = [];
  const probe: ImportReport = {
    notebooks: 0,
    sections: 0,
    pages: 0,
    files: 0,
    templates: 0,
    skipped,
    firstPageId: null,
  };

  const manifestData = await byPath.get('manifest.json')!.read();
  let manifest: { format?: unknown; formatVersion?: unknown; sha256?: Record<string, string> };
  try {
    manifest = JSON.parse(manifestData.toString('utf8'));
  } catch {
    throw fail('This archive’s manifest is damaged.');
  }
  if (manifest.format !== ARCHIVE_FORMAT) throw fail('This isn’t a Memora archive.');
  const version = Number(manifest.formatVersion);
  if (!Number.isInteger(version) || version < 1) throw fail('This archive’s version is unknown.');
  if (version > ARCHIVE_VERSION) {
    throw fail(
      `This archive was made by a newer version of Memora (format ${version}). Update Memora to import it.`,
    );
  }
  const sums = manifest.sha256 ?? {};
  for (const listed of Object.keys(sums)) {
    if (!byPath.has(listed)) throw fail(`The archive is damaged: “${listed}” is missing.`);
  }
  const verify = (path: string, data: Buffer) => {
    const expected = sums[path];
    if (expected === undefined)
      throw fail(`The archive is damaged: “${path}” isn’t in its manifest.`);
    if (expected !== sha256(data)) throw fail(`The archive is damaged: “${path}” has changed.`);
  };

  // What there is, by path.
  const notebooks: z.infer<typeof notebookFile>[] = [];
  const groups: z.infer<typeof groupFile>[] = [];
  const sections: z.infer<typeof sectionFile>[] = [];
  const pages: (z.infer<typeof pageFile> & { body: string })[] = [];
  const history = new Map<string, string>();
  const spill = new Spill(join(context.dir, 'pages'));
  const templates: z.infer<typeof templateFile>[] = [];
  const projects: ProjectFile[] = [];
  const boards: { path: string; file: string }[] = [];
  const paths = [...byPath.keys()];
  const total = paths.length;
  let read = 0;
  const tick = (what: string) => context.progress((++read / total) * 0.5, what);

  for (const path of paths) {
    if (path === 'manifest.json' || path.startsWith('assets/')) continue;
    tick('Reading the archive');
    if (/\/notebook\.json$/.test(path)) {
      const nb = await readJson(byPath.get(path), notebookFile, probe, verify);
      if (nb) notebooks.push(nb);
    } else if (/\/groups\/[^/]+\.json$/.test(path)) {
      const group = await readJson(byPath.get(path), groupFile, probe, verify);
      if (group) groups.push(group);
    } else if (/(^|\/)section\.json$/.test(path)) {
      const section = await readJson(byPath.get(path), sectionFile, probe, verify);
      if (section) sections.push(section);
    } else if (/\/pages\/[^/]+\.json$/.test(path) && !path.endsWith('.rich.json')) {
      const page = await readJson(byPath.get(path), pageFile, probe, verify);
      if (!page) continue;
      const base = path.slice(0, -'.json'.length);
      const body = byPath.get(page.type === 'markdown' ? `${base}.md` : `${base}.rich.json`);
      if (!body) {
        skipped.push({ name: page.title || 'Untitled page', reason: 'Its content is missing.' });
        continue;
      }
      const data = await body.read();
      verify(body.path, data);
      pages.push({ ...page, body: await spill.put(data) });
    } else if (/^history\/[^/]+\.jsonl$/.test(path)) {
      const data = await byPath.get(path)!.read();
      verify(path, data);
      history.set(path.slice('history/'.length, -'.jsonl'.length), await spill.put(data));
    } else if (/^templates\/[^/]+\.json$/.test(path)) {
      const template = await readJson(byPath.get(path), templateFile, probe, verify);
      if (template) templates.push(template);
    } else if (/^kanban\/projects\/[^/]+\.json$/.test(path)) {
      const project = await readJson(byPath.get(path), projectFileSchema, probe, verify);
      if (project) projects.push(project);
    } else if (/^kanban\/boards\/[^/]+\.json$/.test(path)) {
      // Boards can be large: they wait on disk like the pages.
      const data = await byPath.get(path)!.read();
      verify(path, data);
      boards.push({ path, file: await spill.put(data) });
    } else if (path.endsWith('.html')) {
      // The readable copy of a rich page: its document is what is imported.
      const data = await byPath.get(path)!.read();
      verify(path, data);
    }
  }
  const tagColors = new Map(
    ((await readJson(byPath.get('tags.json'), tagsFile, probe, verify)) ?? []).map((t) => [
      tagKey(t.name),
      t.color ?? null,
    ]),
  );

  // Files first, each in its own step: new ids, the same bytes.
  const assetIds = new Map<string, string>();
  const index = (await readJson(byPath.get('assets/index.json'), assetIndex, probe, verify)) ?? [];
  const stored = new Map<string, Buffer | null>();
  for (const [i, asset] of index.entries()) {
    context.progress(0.5 + (i / Math.max(index.length, 1)) * 0.3, 'Files');
    let data = stored.get(asset.file);
    if (data === undefined) {
      const entry = byPath.get(asset.file);
      data = entry ? await entry.read() : null;
      if (data) verify(asset.file, data);
      stored.set(asset.file, data);
    }
    if (!data) {
      skipped.push({ name: asset.name, reason: 'The file is missing from the archive.' });
      continue;
    }
    const id = uuidv7(deps.now());
    deps.assets.put(owner, id, { name: asset.name, claimedType: asset.mime, data });
    assetIds.set(asset.id.toLowerCase(), id);
    probe.files += 1;
    // Only its turn needs its bytes.
    stored.set(asset.file, index.slice(i + 1).some((a) => a.file === asset.file) ? data : null);
  }
  const withFiles = (content: string) =>
    content.replace(/asset:([0-9a-f-]{36})/gi, (whole, id: string) => {
      const mapped = assetIds.get(id.toLowerCase());
      return mapped ? `asset:${mapped}` : whole;
    });

  const versionsIn = (file: string | undefined) =>
    file
      ? spill
          .read(file)
          .split('\n')
          .flatMap((line) => {
            try {
              const parsed = versionLine.safeParse(JSON.parse(line));
              return parsed.success ? [parsed.data] : [];
            } catch {
              return [];
            }
          })
      : [];

  const kanban = { projects: 0, boards: 0, cards: 0 };
  context.progress(0.85, 'Adding the pages');
  const builder = new Builder(db, owner, deps.now());
  db.transaction(() => {
    if (target.notebookId) builder.liveNotebook(target.notebookId);
    // Notebooks and their groups.
    const notebookIds = new Map<string, string>();
    for (const nb of notebooks.sort((a, b) => ((a.sortKey ?? '') < (b.sortKey ?? '') ? -1 : 1))) {
      notebookIds.set(nb.id, target.notebookId ?? builder.notebook(nb.name, nb.color, nb.icon));
    }
    const groupIds = new Map<string, string>();
    const placeGroups = (parent: string | null, depth: number) => {
      for (const group of groups
        .filter((g) => (g.parentGroupId ?? null) === parent)
        .sort((a, b) => ((a.sortKey ?? '') < (b.sortKey ?? '') ? -1 : 1))) {
        const notebookId = notebookIds.get(group.notebookId);
        if (!notebookId || depth > MAX_GROUP_DEPTH) continue;
        groupIds.set(
          group.id,
          builder.group(notebookId, parent ? groupIds.get(parent)! : null, group.name),
        );
        placeGroups(group.id, depth + 1);
      }
    };
    placeGroups(null, 1);
    // Sections (the inbox's pages join the user's inbox).
    const sectionIds = new Map<string, string>();
    let loose: string | null = null;
    for (const section of sections.sort((a, b) =>
      (a.sortKey ?? '') < (b.sortKey ?? '') ? -1 : 1,
    )) {
      if (section.isInbox) {
        sectionIds.set(section.id, target.inboxId);
        continue;
      }
      let notebookId = section.notebookId ? notebookIds.get(section.notebookId) : undefined;
      if (!notebookId)
        notebookId = loose ??=
          target.notebookId ?? builder.notebook('Imported', undefined, undefined);
      const groupId = section.groupId ? (groupIds.get(section.groupId) ?? null) : null;
      sectionIds.set(section.id, builder.section(notebookId, groupId, section.name, section.color));
    }
    // Pages, parents before their subpages.
    const pageIds = new Map<string, string>();
    const place = (parent: string | null, depth: number) => {
      for (const page of pages
        .filter((p) => (p.parentPageId ?? null) === parent)
        .sort((a, b) => ((a.sortKey ?? '') < (b.sortKey ?? '') ? -1 : 1))) {
        const sectionId = sectionIds.get(page.sectionId);
        if (!sectionId) {
          skipped.push({ name: page.title || 'Untitled page', reason: 'Its section is missing.' });
          continue;
        }
        const id = builder.page({
          sectionId,
          parentPageId: parent && depth <= MAX_PAGE_DEPTH ? (pageIds.get(parent) ?? null) : null,
          title: page.title,
          type: page.type,
          content: withFiles(spill.read(page.body)),
          viewMode: page.viewMode,
          createdAt: page.createdAt,
          updatedAt: page.updatedAt,
          tags: (page.tags ?? []).map((name) => ({ name, color: tagColors.get(tagKey(name)) })),
        });
        if (!id) continue;
        pageIds.set(page.id, id);
        for (const version of versionsIn(history.get(page.id))) {
          db.prepare(
            `INSERT INTO page_versions (id, owner_id, page_id, revision, type, title, content, reason, name,
               device_label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            uuidv7(deps.now()),
            owner,
            id,
            version.revision,
            version.type,
            version.title,
            withFiles(version.content),
            version.reason,
            version.name ?? null,
            version.deviceLabel ?? '',
            version.createdAt,
          );
        }
        place(page.id, depth + 1);
      }
    };
    place(null, 1);
    // Pages whose parent never came: at the top of their section.
    for (const page of pages) {
      if (page.parentPageId && !pageIds.has(page.id) && !pageIds.has(page.parentPageId)) {
        const sectionId = sectionIds.get(page.sectionId);
        if (!sectionId) continue;
        const id = builder.page({
          sectionId,
          parentPageId: null,
          title: page.title,
          type: page.type,
          content: withFiles(spill.read(page.body)),
          tags: (page.tags ?? []).map((name) => ({ name, color: tagColors.get(tagKey(name)) })),
        });
        if (id) pageIds.set(page.id, id);
      }
    }
    for (const template of templates) {
      db.prepare(
        `INSERT INTO templates (id, owner_id, name, type, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        uuidv7(deps.now()),
        owner,
        clip(template.name, 100),
        template.type,
        withFiles(template.content),
        deps.now(),
        deps.now(),
      );
      builder.report.templates += 1;
    }
    if (projects.length) {
      const counts = importKanban(
        db,
        owner,
        projects,
        function* () {
          for (const board of boards) {
            try {
              const parsed = boardFileSchema.safeParse(JSON.parse(spill.read(board.file)));
              if (parsed.success) yield parsed.data;
              else skipped.push({ name: board.path, reason: 'It isn’t valid.' });
            } catch {
              skipped.push({ name: board.path, reason: 'It isn’t valid.' });
            }
          }
        },
        pageIds,
        withFiles,
        assetIds,
        deps.now(),
        (c) => COLOR_IDS.includes(c as never),
      );
      Object.assign(kanban, counts);
    }
  })();
  return {
    ...builder.report,
    files: probe.files,
    skipped: [...skipped, ...builder.report.skipped],
    ...(kanban.projects ? kanban : {}),
  };
}

const PAGE_FILE = /\.(md|markdown|txt)$/i;

/** A type for a file Markdown links to, from its name (images are recognised by their bytes). */
function typeByExtension(name: string): string | undefined {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const known: Record<string, string> = {
    pdf: 'application/pdf',
    svg: 'image/svg+xml',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    zip: 'application/zip',
  };
  return extension ? known[extension] : undefined;
}

/** A folder of a Markdown zip: its pages and subfolders. */
interface Folder {
  name: string;
  files: ZipEntry[];
  folders: Map<string, Folder>;
}

const folder = (name: string): Folder => ({ name, files: [], folders: new Map() });

async function importMarkdownFolder(
  deps: ImportDeps,
  entries: ZipEntry[],
  fileName: string,
  target: ImportTarget,
  context: JobContext,
): Promise<ImportReport> {
  const pagesIn = entries.filter(
    (e) => PAGE_FILE.test(e.path) && !/(^|\/)(__MACOSX|\.)/.test(e.path),
  );
  if (!pagesIn.length) throw fail('There are no Markdown files in this zip.');
  const byPath = new Map(entries.map((e) => [e.path, e]));

  // One folder around everything is the notebook.
  const tops = new Set(pagesIn.map((e) => (e.path.includes('/') ? e.path.split('/')[0] : '')));
  const wrapper = tops.size === 1 && !tops.has('') ? [...tops][0]! : null;
  const notebookName = wrapper ?? fileName.replace(/\.zip$/i, '');
  const root = folder(notebookName);
  for (const entry of pagesIn) {
    const parts = entry.path.split('/');
    if (wrapper) parts.shift();
    parts.pop();
    let at = root;
    for (const part of parts) {
      let next = at.folders.get(part);
      if (!next) at.folders.set(part, (next = folder(part)));
      at = next;
    }
    at.files.push(entry);
  }

  // Files the pages point at, stored once each.
  const stored = new Map<string, string | null>();
  const fileFor = async (from: string, href: string): Promise<string | null> => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/'))
      return null;
    let decoded: string;
    try {
      decoded = decodeURI(href.split('#')[0]!.split('?')[0]!);
    } catch {
      return null;
    }
    const path = posix.normalize(posix.join(posix.dirname(from), decoded));
    if (PAGE_FILE.test(path)) return null;
    if (stored.has(path)) return stored.get(path)!;
    const entry = byPath.get(path);
    let id: string | null = null;
    if (entry) {
      const data = await entry.read();
      id = uuidv7(deps.now());
      const name = posix.basename(path);
      deps.assets.put(target.owner, id, { name, claimedType: typeByExtension(name), data });
      files += 1;
    }
    stored.set(path, id);
    return id;
  };
  let files = 0;

  // Pages' text, with front matter read and relative files stored.
  const spill = new Spill(join(context.dir, 'pages'));
  interface Parsed {
    title: string;
    /** Its text, spilled. */
    file: string;
    tags: string[];
    createdAt?: number;
    updatedAt?: number;
  }
  const parsed = new Map<ZipEntry, Parsed>();
  let done = 0;
  const link = /(!?\[[^\]\n]*\]\()(<[^>\n]+>|[^)\s]+)((?:\s+"[^"\n]*")?\))/g;
  for (const entry of pagesIn) {
    context.progress((done++ / pagesIn.length) * 0.8, `Pages: ${done} of ${pagesIn.length}`);
    const raw = (await entry.read()).toString('utf8').replace(/^\uFEFF/, '');
    const isText = /\.txt$/i.test(entry.path);
    const { fields, body } = isText ? { fields: {}, body: raw } : readFrontMatter(raw);
    let content = body;
    if (!isText) {
      const replacements: [string, string][] = [];
      for (const match of body.matchAll(link)) {
        const href = match[2]!.replace(/^<|>$/g, '');
        const id = await fileFor(entry.path, href);
        if (id) replacements.push([match[0], `${match[1]}asset:${id}${match[3]}`]);
      }
      for (const [from, to] of replacements) content = content.replace(from, to);
    }
    const date = (value: string | undefined) => {
      const ms = value ? Date.parse(value) : NaN;
      return Number.isFinite(ms) ? ms : undefined;
    };
    parsed.set(entry, {
      title: fields.title ?? posix.basename(entry.path).replace(PAGE_FILE, ''),
      file: await spill.put(content),
      tags: fields.tags ?? [],
      createdAt: date(fields.created),
      updatedAt: date(fields.updated),
    });
  }

  context.progress(0.9, 'Adding the pages');
  const builder = new Builder(deps.db, target.owner, deps.now());
  deps.db.transaction(() => {
    if (target.notebookId) builder.liveNotebook(target.notebookId);
    const notebookId = target.notebookId ?? builder.notebook(notebookName, undefined, undefined);
    const pageFrom = (entry: ZipEntry, sectionId: string, parent: string | null) => {
      const page = parsed.get(entry)!;
      return builder.page({
        sectionId,
        parentPageId: parent,
        title: page.title,
        type: 'markdown',
        content: spill.read(page.file),
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
        tags: page.tags.map((name) => ({ name })),
      });
    };
    // In a section: files are pages, a folder holds the subpages of the page named like it.
    const pagesOf = (at: Folder, sectionId: string, parent: string | null, depth: number) => {
      const named = new Map<string, string>();
      for (const entry of at.files) {
        const id = pageFrom(entry, sectionId, depth > MAX_PAGE_DEPTH ? null : parent);
        if (id) named.set(posix.basename(entry.path).replace(PAGE_FILE, '').toLowerCase(), id);
      }
      for (const [name, sub] of at.folders) {
        if (name.toLowerCase() === 'assets') continue;
        const owner =
          named.get(name.toLowerCase()) ??
          builder.page({
            sectionId,
            parentPageId: depth > MAX_PAGE_DEPTH ? null : parent,
            title: name,
            type: 'markdown',
            content: '',
          });
        pagesOf(sub, sectionId, owner, depth + 1);
      }
    };
    // Folders of folders (and no pages) are section groups.
    const isGroup = (at: Folder) => !at.files.length && at.folders.size > 0;
    const sectionsOf = (at: Folder, groupId: string | null, depth: number) => {
      for (const [name, sub] of at.folders) {
        if (name.toLowerCase() === 'assets' && !sub.files.length) continue;
        if (isGroup(sub) && depth <= MAX_GROUP_DEPTH) {
          sectionsOf(sub, builder.group(notebookId, groupId, name), depth + 1);
        } else {
          pagesOf(sub, builder.section(notebookId, groupId, name), null, 1);
        }
      }
    };
    if (root.files.length)
      pagesOf(
        { ...root, folders: new Map() },
        builder.section(notebookId, null, notebookName),
        null,
        1,
      );
    sectionsOf(root, null, 1);
  })();
  return { ...builder.report, files };
}
