import {
  ASSET_SCHEME,
  DIAGRAM_LANGUAGE,
  assetPath,
  htmlDocument,
  parseRich,
  richToHtml,
  type Page,
  type RichNode,
} from '@memora/shared';
import type { Drawing } from '../diagrams/render';
import { api } from '../lib/api';
import type { NotesIndex } from '../notes/model';

/*
 * What Word, HTML and PDF exports are made from (§9.10): the pages of a page or section as
 * rich documents, Markdown pages converted the way "Convert to rich text" does, so every
 * format has one way to write each kind of block.
 */

export interface DocumentPage {
  id: string;
  title: string;
  /** 1 for a top-level page. */
  depth: number;
  doc: RichNode;
}

export interface ExportDocument {
  title: string;
  pages: DocumentPage[];
  /** The diagrams, drawn for the export (light, with the font inside), by their code. */
  diagrams?: Map<string, Drawing>;
}

/** The pages to export: one page, or a section's pages in list order. */
export function pagesIn(
  index: NotesIndex,
  scope: 'page' | 'section',
  id: string,
): { title: string; pages: { id: string; title: string; depth: number }[] } {
  if (scope === 'page') {
    const page = index.page.get(id);
    return {
      title: page?.title || 'Untitled page',
      pages: page ? [{ id, title: page.title, depth: 1 }] : [],
    };
  }
  const section = index.section.get(id);
  return {
    title: section?.name ?? 'Section',
    pages: index
      .pagesOf(id)
      .map((row) => ({ id: row.page.id, title: row.page.title, depth: row.depth })),
  };
}

export async function loadDocument(
  index: NotesIndex,
  scope: 'page' | 'section',
  id: string,
  progress: (done: number, total: number) => void = () => undefined,
): Promise<ExportDocument> {
  const { title, pages } = pagesIn(index, scope, id);
  const { markdownToRich } = await import('../rich/convert');
  const out: DocumentPage[] = [];
  for (const [i, item] of pages.entries()) {
    progress(i, pages.length);
    const page = await api<Page>('GET', `/pages/${item.id}`);
    const doc =
      page.type === 'rich'
        ? (parseRich(page.content) ?? { type: 'doc', content: [] })
        : markdownToRich(page.content);
    out.push({ id: page.id, title: page.title, depth: item.depth, doc });
  }
  progress(pages.length, pages.length);
  return { title, pages: out, diagrams: await drawDiagrams(out) };
}

/** The code of every diagram in the pages. */
export function diagramsIn(pages: DocumentPage[]): string[] {
  const codes = new Set<string>();
  const walk = (node: RichNode) => {
    if (node.type === 'codeBlock' && node.attrs?.language === DIAGRAM_LANGUAGE) {
      const code = (node.content ?? []).map((c) => c.text ?? '').join('');
      if (code.trim()) codes.add(code);
    }
    node.content?.forEach(walk);
  };
  for (const page of pages) walk(page.doc);
  return [...codes];
}

/** Draws each diagram once; one with a mistake stays code in the export. */
async function drawDiagrams(pages: DocumentPage[]): Promise<Map<string, Drawing>> {
  const drawn = new Map<string, Drawing>();
  const codes = diagramsIn(pages);
  if (!codes.length) return drawn;
  const { renderForExport } = await import('../diagrams/render');
  for (const code of codes) {
    try {
      drawn.set(code, await renderForExport(code));
    } catch {
      // Written as its code.
    }
  }
  return drawn;
}

/** The ids of the files a document shows. */
export function assetsIn(document: ExportDocument): string[] {
  const ids = new Set<string>();
  const walk = (node: RichNode) => {
    const src = node.attrs?.src;
    if (typeof src === 'string' && src.startsWith(ASSET_SCHEME))
      ids.add(src.slice(ASSET_SCHEME.length));
    node.content?.forEach(walk);
  };
  for (const page of document.pages) walk(page.doc);
  return [...ids];
}

export async function fetchAsset(id: string): Promise<Blob | null> {
  try {
    const response = await fetch(assetPath(id), { credentials: 'same-origin' });
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file couldn’t be read.'));
    reader.readAsDataURL(blob);
  });

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The pages' HTML, each under its title; images point wherever `asset` says. */
export function bodyHtml(document: ExportDocument, asset: (id: string) => string | null): string {
  const single = document.pages.length === 1;
  return document.pages
    .map((page) => {
      const level = single ? 1 : Math.min(6, page.depth + 1);
      const heading = single
        ? ''
        : `<h${level} class="page-title">${escape(page.title || 'Untitled page')}</h${level}>\n`;
      const diagram = (code: string) => document.diagrams?.get(code)?.svg ?? null;
      return `<article class="page">\n${heading}${richToHtml(page.doc, { asset, diagram })}</article>\n`;
    })
    .join('');
}

/** One HTML file, readable anywhere: images go inside it. */
export async function htmlFile(document: ExportDocument): Promise<Blob> {
  const images = new Map<string, string>();
  for (const id of assetsIn(document)) {
    const blob = await fetchAsset(id);
    if (blob && blob.type.startsWith('image/')) images.set(id, await dataUrl(blob));
  }
  const html = htmlDocument(
    document.title,
    bodyHtml(document, (id) => images.get(id) ?? null),
  );
  return new Blob([html], { type: 'text/html' });
}
