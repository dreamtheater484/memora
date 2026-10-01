import {
  ASSET_SCHEME,
  DIAGRAM_LANGUAGE,
  assetPath,
  parseRich,
  type PageType,
} from '@memora/shared';
import { generateHTML, type JSONContent } from '@tiptap/core';
import DOMPurify from 'dompurify';
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useDiagramTheme } from '../diagrams/useDiagramTheme';
import { cn } from '../lib/cn';
import { Preview } from '../markdown/Preview';
import { richExtensions } from '../rich/schema';
import '../rich/rich.css';
import type { DiffRow, TextDiff } from './diff';

/*
 * A version as it reads (§9.7): a Markdown page through the preview, a rich page as the
 * editor would show it, read-only. Its files load from the server.
 */

const SAFE_URL = /^(?:https?:|mailto:|asset:|wiki:|data:image\/(?:png|jpeg|gif|webp|avif);)/i;

function richHtml(content: string): string | null {
  const doc = parseRich(content);
  if (!doc) return null;
  let html: string;
  try {
    html = generateHTML(doc as JSONContent, richExtensions());
  } catch {
    return null;
  }
  const root = DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: SAFE_URL,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    if (src.startsWith(ASSET_SCHEME)) img.src = assetPath(src.slice(ASSET_SCHEME.length));
  }
  for (const a of root.querySelectorAll('a')) {
    // Links to pages and files don't lead anywhere from here; web links open beside the app.
    if (/^https?:/i.test(a.getAttribute('href') ?? '')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    } else a.removeAttribute('href');
  }
  const box = document.createElement('div');
  box.append(root);
  return box.innerHTML;
}

/** Draws the diagrams (code blocks in Mermaid) of a version shown as HTML. */
function useDrawnDiagrams(box: RefObject<HTMLDivElement | null>, html: string | null) {
  const theme = useDiagramTheme();
  useEffect(() => {
    const root = box.current;
    if (!root || !html) return;
    let live = true;
    const blocks = [
      ...root.querySelectorAll<HTMLElement>(`pre > code.language-${DIAGRAM_LANGUAGE}`),
    ];
    for (const code of blocks) {
      const pre = code.parentElement!;
      void import('../diagrams/render')
        .then(({ renderDiagram }) => renderDiagram(code.textContent ?? '', theme))
        .then(
          (drawing) => {
            if (!live || !pre.isConnected) return;
            const figure = document.createElement('div');
            figure.className = 'diagram-drawing';
            figure.dataset.state = 'drawn';
            // Sanitised by Mermaid's strict mode and again in render.ts.
            figure.innerHTML = drawing.svg;
            pre.replaceWith(figure);
          },
          () => undefined,
        );
    }
    return () => {
      live = false;
    };
  }, [box, html, theme]);
}

export function VersionView({ type, content }: { type: PageType; content: string }) {
  const html = useMemo(() => (type === 'rich' ? richHtml(content) : null), [type, content]);
  const box = useRef<HTMLDivElement>(null);
  useDrawnDiagrams(box, html);
  if (type === 'markdown') return <Preview text={content} className="version-view" />;
  if (html === null) {
    return <p className="text-sm text-fg-3">This version can’t be shown.</p>;
  }
  return (
    <div
      ref={box}
      className="markdown-body rich-content version-view"
      // Sanitised above.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Row({ row }: { row: DiffRow }) {
  if (row.kind === 'gap') {
    return (
      <div className="px-3 py-1 font-sans text-2xs text-fg-3">
        {row.lines} unchanged {row.lines === 1 ? 'line' : 'lines'}
      </div>
    );
  }
  if (row.kind === 'same') {
    return <div className="px-3 text-fg-3">{row.text || ' '}</div>;
  }
  const added = row.kind === 'added';
  return (
    <div
      data-change={row.kind}
      className={cn('px-3', added ? 'bg-ok/12 text-fg' : 'bg-danger/10 text-fg-2')}
    >
      <span aria-hidden className="mr-2 inline-block w-2 text-fg-3 select-none">
        {added ? '+' : '−'}
      </span>
      <span className="sr-only">{added ? 'Added: ' : 'Removed: '}</span>
      {row.parts.map((part, i) =>
        part.changed ? (
          added ? (
            <ins key={i} className="rounded-xs bg-ok/30 no-underline">
              {part.text}
            </ins>
          ) : (
            <del key={i} className="rounded-xs bg-danger/25">
              {part.text}
            </del>
          )
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
      {row.parts.every((p) => !p.text) && ' '}
    </div>
  );
}

export function DiffView({ diff, none }: { diff: TextDiff; none: string }) {
  if (!diff.rows.length) return <p className="text-sm text-fg-3">{none}</p>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-fg-2">
        <span className="font-semibold text-ok">
          {diff.added} {diff.added === 1 ? 'line' : 'lines'} added
        </span>
        {' · '}
        <span className="font-semibold text-danger">{diff.removed} removed</span>
      </p>
      <div
        role="list"
        aria-label="Changes"
        className="overflow-x-auto rounded-md border border-line py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap"
      >
        {diff.rows.map((row, i) => (
          <div role="listitem" key={i}>
            <Row row={row} />
          </div>
        ))}
      </div>
    </div>
  );
}
