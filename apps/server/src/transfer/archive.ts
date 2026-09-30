import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ARCHIVE_FORMAT,
  ARCHIVE_VERSION,
  htmlDocument,
  linkedTitles,
  parseRich,
  richToHtml,
  safeFileName,
  type ArchiveManifest,
} from '@memora/shared';
import { encryptFile } from '../backup/envelope';
import type { SqliteDatabase } from '../db/client';
import type { JobContext, JobResult } from './jobs';
import {
  assetsOf,
  blobOf,
  contentOf,
  extensionOf,
  type Collected,
  type SectionItem,
} from './collect';
import { boardFile, boardIds, cardAssetIds, projectFiles } from './kanban';
import { ZipWriter } from './zip';

/*
 * The `.memora` archive (docs/FILE_FORMAT.md): everything in a scope, as JSON, Markdown and
 * the files, with a manifest of SHA-256 sums; rich pages also as HTML, readable without
 * Memora. Optionally encrypted with the backup envelope (§9.14).
 */

export interface ArchiveOptions {
  appVersion: string;
  history: boolean;
  password?: string;
  now: number;
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Where a section's files go in the archive. */
export function sectionDir(section: SectionItem): string {
  if (section.isInbox) return 'inbox';
  return section.notebookId
    ? `notebooks/${section.notebookId}/sections/${section.id}`
    : `sections/${section.id}`;
}

export function archiveName(collected: Collected, now: number): string {
  const date = new Date(now).toISOString().slice(0, 10);
  const first = collected.scope.ids[0];
  const named =
    collected.scope.type === 'notebook'
      ? collected.notebooks[0]?.name
      : collected.scope.type === 'group'
        ? undefined
        : collected.scope.type === 'section'
          ? collected.sections.find((s) => s.id === first)?.name
          : collected.scope.type === 'page'
            ? collected.pages.find((p) => p.id === first)?.title
            : undefined;
  return `${safeFileName(named ?? 'Memora')} ${date}`;
}

export async function writeArchive(
  db: SqliteDatabase,
  owner: string,
  collected: Collected,
  options: ArchiveOptions,
  context: JobContext,
): Promise<JobResult> {
  const zipPath = join(context.dir, 'archive.zip');
  const zip = new ZipWriter(zipPath);
  const sections = new Map(collected.sections.map((s) => [s.id, s]));

  for (const nb of collected.notebooks) {
    zip.add(`notebooks/${nb.id}/notebook.json`, () => json(nb), nb.updatedAt);
  }
  for (const group of collected.groups) {
    zip.add(
      `notebooks/${group.notebookId}/groups/${group.id}.json`,
      () => json(group),
      group.updatedAt,
    );
  }
  for (const section of collected.sections) {
    zip.add(`${sectionDir(section)}/section.json`, () => json(section), section.updatedAt);
  }

  const total = collected.pages.length;
  let versions = 0;
  collected.pages.forEach((page, i) => {
    const dir = `${sectionDir(sections.get(page.sectionId)!)}/pages`;
    // Read once, when the first of the page's files is written.
    let content: string | null = null;
    const text = () => {
      if (content === null) {
        content = contentOf(db, page.id);
        context.progress((i / Math.max(total, 1)) * 0.8, `Pages: ${i + 1} of ${total}`);
      }
      return content;
    };
    zip.add(
      `${dir}/${page.id}.json`,
      () =>
        json({
          ...page,
          tags: collected.tags.get(page.id) ?? [],
          links: linkedTitles(page.type, text()),
        }),
      page.updatedAt,
    );
    if (page.type === 'markdown') {
      zip.add(`${dir}/${page.id}.md`, () => text(), page.updatedAt);
    } else {
      zip.add(`${dir}/${page.id}.rich.json`, () => text(), page.updatedAt);
      zip.add(
        `${dir}/${page.id}.html`,
        () => {
          const doc = parseRich(text());
          const depth = dir.split('/').length;
          const up = '../'.repeat(depth);
          return htmlDocument(
            page.title || 'Untitled page',
            doc
              ? richToHtml(doc, {
                  asset: (id) => {
                    const file = assetFiles.get(id);
                    return file ? `${up}${file}` : null;
                  },
                })
              : '',
          );
        },
        page.updatedAt,
      );
    }
    if (options.history) {
      const rows = db
        .prepare(
          `SELECT id, revision, type, title, content, reason, name, device_label AS deviceLabel, created_at AS createdAt
           FROM page_versions WHERE page_id = ? AND owner_id = ? ORDER BY created_at`,
        )
        .all(page.id, owner);
      if (rows.length) {
        versions += rows.length;
        zip.add(
          `history/${page.id}.jsonl`,
          () => rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
        );
      }
    }
  });

  // Files, each stored once however many pages or ids refer to it.
  context.progress(0.8, 'Files');
  const everything = collected.scope.type === 'everything';
  const assets = assetsOf(
    db,
    owner,
    collected.pages.map((p) => p.id),
    everything ? cardAssetIds(db, owner) : [],
  );
  const assetFiles = new Map<string, string>();
  const written = new Set<string>();
  for (const asset of assets) {
    const file = `assets/${asset.sha256}.${extensionOf(asset.mime, asset.name)}`;
    assetFiles.set(asset.id, file);
    if (written.has(file)) continue;
    written.add(file);
    zip.add(file, () => blobOf(db, owner, asset.sha256));
  }
  zip.add('assets/index.json', () =>
    json(assets.map((a) => ({ ...a, file: assetFiles.get(a.id) }))),
  );
  zip.add('tags.json', () => json(collected.tagList));

  let templates = 0;
  if (collected.scope.type === 'everything') {
    const rows = db
      .prepare(
        `SELECT id, name, type, content, created_at AS createdAt, updated_at AS updatedAt
         FROM templates WHERE owner_id = ? ORDER BY name`,
      )
      .all(owner) as { id: string }[];
    templates = rows.length;
    for (const row of rows) zip.add(`templates/${row.id}.json`, () => json(row));
  }

  // Kanban, with everything (§9.11): a file per project and per board.
  let kanban = { projects: 0, boards: 0, cards: 0 };
  if (everything) {
    const projects = projectFiles(db, owner);
    for (const project of projects)
      zip.add(`kanban/projects/${project.id}.json`, () => json(project));
    const boards = boardIds(db, owner);
    for (const id of boards) zip.add(`kanban/boards/${id}.json`, () => json(boardFile(db, id)));
    const { n } = db.prepare('SELECT count(*) AS n FROM cards WHERE owner_id = ?').get(owner) as {
      n: number;
    };
    kanban = { projects: projects.length, boards: boards.length, cards: n };
  }

  // Last: it lists the others, which are all written by the time it is.
  zip.add('manifest.json', () =>
    json({
      format: ARCHIVE_FORMAT,
      formatVersion: ARCHIVE_VERSION,
      appVersion: options.appVersion,
      exportedAt: new Date(options.now).toISOString(),
      scope: collected.scope,
      counts: {
        notebooks: collected.notebooks.length,
        groups: collected.groups.length,
        sections: collected.sections.length,
        pages: collected.pages.length,
        assets: assets.length,
        templates,
        versions,
        ...(everything ? kanban : {}),
      },
      sha256: { ...zip.hashes },
    } satisfies ArchiveManifest),
  );
  await zip.close();

  const name = `${archiveName(collected, options.now)}.memora`;
  if (!options.password)
    return { file: { path: zipPath, name }, exportReport: report(collected, assets.length) };
  context.progress(0.95, 'Encrypting');
  const encrypted = join(context.dir, 'archive.memora');
  await encryptFile(zipPath, encrypted, options.password);
  await rm(zipPath, { force: true });
  return { file: { path: encrypted, name }, exportReport: report(collected, assets.length) };
}

const report = (collected: Collected, files: number) => ({
  pages: collected.pages.length,
  files,
  lost: [],
});
