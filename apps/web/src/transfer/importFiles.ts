import {
  ASSET_SCHEME,
  MAX_INITIAL_CONTENT,
  readFrontMatter,
  uuidv7,
  type AssetMeta,
  type ContentSaved,
  type PageType,
  type TreeChanges,
} from '@memora/shared';
import { api, errorMessage, uploadFile } from '../lib/api';
import { downloadImage, isWebImage, MAX_PASTED_DOWNLOADS } from '../lib/remoteImages';

/*
 * Single files imported in the browser (§9.10): Markdown and text files become Markdown
 * pages; Word and HTML files become rich pages, read the way pasted HTML is, with their
 * images stored as the page's files. `.memora` archives and zips go to the server instead.
 */

/** Files the browser turns into pages. */
export const PAGE_FILES = /\.(md|markdown|txt|docx|html?)$/i;
/** Files the server imports. */
export const ARCHIVE_FILES = /\.(memora|zip)$/i;
export const IMPORT_ACCEPT = '.memora,.zip,.md,.markdown,.txt,.docx,.html,.htm';

export interface PagesImported {
  pageIds: string[];
  failed: { name: string; reason: string }[];
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

/** Stores the images of imported HTML as files; web images are downloaded by the server. */
async function keepImages(root: HTMLElement): Promise<void> {
  let downloads = 0;
  for (const img of [...root.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? '';
    try {
      if (src.startsWith('data:image/')) {
        const blob = await (await fetch(src)).blob();
        const id = uuidv7();
        const extension =
          blob.type.split('/')[1]?.replace('jpeg', 'jpg').replace(/\+.*/, '') ?? 'png';
        await uploadFile<AssetMeta>(
          `/assets/${id}?name=${encodeURIComponent(`image.${extension}`)}`,
          blob,
        );
        img.setAttribute('src', `${ASSET_SCHEME}${id}`);
      } else if (isWebImage(src) && downloads < MAX_PASTED_DOWNLOADS) {
        downloads += 1;
        img.setAttribute('src', await downloadImage(src));
      } else if (!src.startsWith(ASSET_SCHEME)) {
        img.remove();
      }
    } catch {
      // Web images that can't be downloaded keep their address, as when pasting.
      if (!isWebImage(src)) img.remove();
    }
  }
}

/** HTML as a rich document, read like pasted HTML. */
async function richFromHtml(html: string): Promise<string> {
  const [{ cleanPastedHtml }, { generateJSON }, { richExtensions }] = await Promise.all([
    import('../rich/clean'),
    import('@tiptap/core'),
    import('../rich/schema'),
  ]);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  await keepImages(doc.body);
  return JSON.stringify(generateJSON(cleanPastedHtml(doc.body.innerHTML), richExtensions()));
}

interface Converted {
  title: string;
  type: PageType;
  content: string;
  tags: string[];
}

export async function convertFile(file: File): Promise<Converted> {
  const name = file.name;
  if (/\.(md|markdown)$/i.test(name)) {
    const { fields, body } = readFrontMatter((await file.text()).replace(/^\uFEFF/, ''));
    return {
      title: fields.title ?? baseName(name),
      type: 'markdown',
      content: body,
      tags: fields.tags ?? [],
    };
  }
  if (/\.txt$/i.test(name)) {
    return {
      title: baseName(name),
      type: 'markdown',
      content: (await file.text()).replace(/^\uFEFF/, ''),
      tags: [],
    };
  }
  if (/\.docx$/i.test(name)) {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
    return { title: baseName(name), type: 'rich', content: await richFromHtml(value), tags: [] };
  }
  if (/\.html?$/i.test(name)) {
    const text = await file.text();
    const title = new DOMParser().parseFromString(text, 'text/html').title.trim();
    return {
      title: title || baseName(name),
      type: 'rich',
      content: await richFromHtml(text),
      tags: [],
    };
  }
  throw new Error('Memora can’t import this kind of file.');
}

/** Creates a page from a converted file; long content is saved after the page is made. */
async function createPage(sectionId: string, page: Converted): Promise<string> {
  const small = page.content.length <= MAX_INITIAL_CONTENT;
  const created = await api<TreeChanges>('POST', '/pages', {
    sectionId,
    title: page.title.slice(0, 200),
    type: page.type,
    content: small ? page.content : '',
  });
  const meta = created.pages![0]!;
  if (!small) {
    await api<ContentSaved>('PUT', `/pages/${meta.id}/content`, {
      baseRevision: meta.revision,
      content: page.content,
    });
  }
  if (page.tags.length)
    await api('PUT', `/pages/${meta.id}/tags`, { names: page.tags.slice(0, 20) });
  return meta.id;
}

/** Imports files as pages at the end of a section. */
export async function importPageFiles(
  files: readonly File[],
  sectionId: string,
  progress: (done: number, total: number) => void = () => undefined,
): Promise<PagesImported> {
  const result: PagesImported = { pageIds: [], failed: [] };
  for (const [i, file] of files.entries()) {
    progress(i, files.length);
    try {
      result.pageIds.push(await createPage(sectionId, await convertFile(file)));
    } catch (error) {
      result.failed.push({
        name: file.name,
        reason:
          error instanceof Error && !('status' in error) ? error.message : errorMessage(error),
      });
    }
  }
  progress(files.length, files.length);
  return result;
}
