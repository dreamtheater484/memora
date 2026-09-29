import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RICH_LOSSES,
  parseRich,
  richToMarkdown,
  safeFileName,
  uniqueNames,
  writeFrontMatter,
  type ExportReport,
} from '@memora/shared';
import type { SqliteDatabase } from '../db/client';
import { archiveName } from './archive';
import {
  assetsOf,
  blobOf,
  contentOf,
  type Collected,
  type PageItem,
  type SectionItem,
} from './collect';
import type { JobContext, JobResult } from './jobs';
import { ZipWriter } from './zip';

/*
 * The Markdown folder (§8.5): for other tools, with readable names. Notebooks, groups and
 * sections are folders, pages are `.md` files with a front-matter block, subpages go in a
 * folder named like their page, and files in `assets/`. Rich pages are converted, and the
 * report says what Markdown couldn't keep.
 */

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export async function writeMarkdown(
  db: SqliteDatabase,
  owner: string,
  collected: Collected,
  now: number,
  context: JobContext,
): Promise<JobResult> {
  const notebooks = new Map(collected.notebooks.map((n) => [n.id, n]));
  const groups = new Map(collected.groups.map((g) => [g.id, g]));
  const scope = collected.scope.type;

  // Folder names, unique within their folder.
  const namers = new Map<string, (name: string) => string>();
  const unique = (folder: string, name: string) => {
    let namer = namers.get(folder);
    if (!namer) namers.set(folder, (namer = uniqueNames()));
    return namer(name);
  };
  const folders = new Map<string, string>();
  const folderOf = (key: string, parent: string, name: string) => {
    let folder = folders.get(key);
    if (folder === undefined) {
      const own = unique(parent, safeFileName(name));
      folder = parent ? `${parent}/${own}` : own;
      folders.set(key, folder);
    }
    return folder;
  };
  const groupFolder = (groupId: string, notebookFolder: string): string => {
    const group = groups.get(groupId);
    if (!group) return notebookFolder;
    const parent =
      group.parentGroupId && groups.has(group.parentGroupId)
        ? groupFolder(group.parentGroupId, notebookFolder)
        : notebookFolder;
    return folderOf(`g:${group.id}`, parent, group.name);
  };
  const sectionFolder = (section: SectionItem): string => {
    if (section.isInbox) return folderOf(`s:${section.id}`, '', 'Inbox');
    if (scope === 'section' || scope === 'page')
      return folderOf(`s:${section.id}`, '', section.name);
    const notebook = section.notebookId ? notebooks.get(section.notebookId) : undefined;
    const top =
      scope === 'group' || !notebook ? '' : folderOf(`n:${notebook.id}`, '', notebook.name);
    const parent = section.groupId ? groupFolder(section.groupId, top) : top;
    return folderOf(`s:${section.id}`, parent, section.name);
  };

  // Pages, subpages in a folder named like their page.
  const children = new Map<string | null, PageItem[]>();
  for (const page of collected.pages) {
    const key = page.parentPageId ?? `section:${page.sectionId}`;
    children.set(key, [...(children.get(key) ?? []), page]);
  }
  const files: { page: PageItem; path: string }[] = [];
  const place = (list: PageItem[], folder: string) => {
    for (const page of list) {
      const base = unique(folder, safeFileName(page.title, 'Untitled page'));
      const path = folder ? `${folder}/${base}.md` : `${base}.md`;
      files.push({ page, path });
      const below = children.get(page.id);
      if (below?.length) place(below, folder ? `${folder}/${base}` : base);
    }
  };
  for (const section of collected.sections) {
    const top = children.get(`section:${section.id}`) ?? [];
    // A single page is exported on its own, without its section's folder.
    place(top, scope === 'page' ? '' : sectionFolder(section));
  }

  // Files, in `assets/` at the top, named after their original names.
  const assets = assetsOf(
    db,
    owner,
    collected.pages.map((p) => p.id),
  );
  const assetPaths = new Map<string, string>();
  const bySha = new Map<string, string>();
  for (const asset of assets) {
    let path = bySha.get(asset.sha256);
    if (!path) {
      path = `assets/${unique('assets', safeFileName(asset.name, 'file'))}`;
      bySha.set(asset.sha256, path);
    }
    assetPaths.set(asset.id, path);
  }

  const lost: ExportReport['lost'] = [];
  const render = (page: PageItem, path: string): string => {
    let body = contentOf(db, page.id);
    if (page.type === 'rich') {
      const doc = parseRich(body);
      const result = doc ? richToMarkdown(doc) : { markdown: '', lost: [] };
      body = result.markdown;
      if (result.lost.length) {
        lost.push({
          title: page.title || 'Untitled page',
          lost: result.lost.map((l) => RICH_LOSSES[l]),
        });
      }
    }
    const up = '../'.repeat(path.split('/').length - 1);
    body = body.replace(/asset:([0-9a-f-]{36})/gi, (whole, id: string) => {
      const target = assetPaths.get(id.toLowerCase());
      return target ? encodePath(`${up}${target}`) : whole;
    });
    const title = safeFileName(page.title, 'Untitled page');
    return (
      writeFrontMatter({
        ...(title !== page.title ? { title: page.title } : {}),
        id: page.id,
        tags: collected.tags.get(page.id),
        created: new Date(page.createdAt).toISOString(),
        updated: new Date(page.updatedAt).toISOString(),
      }) + body
    );
  };

  const exportReport = (): ExportReport => ({ pages: files.length, files: bySha.size, lost });
  const name = archiveName(collected, now);

  // One page without files: a plain `.md` file.
  if (files.length === 1 && !assets.length && scope === 'page') {
    const path = join(context.dir, 'page.md');
    await writeFile(path, render(files[0]!.page, files[0]!.path));
    return { file: { path, name: `${name}.md` }, exportReport: exportReport() };
  }

  const zipPath = join(context.dir, 'markdown.zip');
  const zip = new ZipWriter(zipPath);
  files.forEach(({ page, path }, i) => {
    zip.add(
      path,
      () => {
        context.progress(
          (i / Math.max(files.length, 1)) * 0.9,
          `Pages: ${i + 1} of ${files.length}`,
        );
        return render(page, path);
      },
      page.updatedAt,
    );
  });
  for (const [sha, path] of bySha) zip.add(path, () => blobOf(db, owner, sha));
  await zip.close();
  return { file: { path: zipPath, name: `${name}.zip` }, exportReport: exportReport() };
}
