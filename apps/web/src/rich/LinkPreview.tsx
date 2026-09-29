import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PageCard, pageCardClass } from '../markdown/PageCard';
import type { PageSummary } from '../notes/summary';
import { wikiTitle } from './wikiLinks';

/*
 * A preview of the page a link leads to while the pointer rests on the link (§9.9), in the rich
 * editor, where links are part of the document rather than components.
 */
export function LinkPreview({
  editor,
  summaryOf,
}: {
  editor: Editor | null;
  summaryOf: (title: string) => PageSummary | null;
}) {
  const [shown, setShown] = useState<{ summary: PageSummary; x: number; y: number } | null>(null);
  useEffect(() => {
    const dom = editor && !editor.isDestroyed ? editor.view.dom : null;
    if (!dom) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const over = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest?.('a[href^="wiki:"]');
      clearTimeout(timer);
      if (!link) return;
      timer = setTimeout(() => {
        const title = wikiTitle(link.getAttribute('href'));
        const summary = title ? summaryOf(title) : null;
        const rect = link.getBoundingClientRect();
        setShown(summary ? { summary, x: rect.left, y: rect.bottom + 6 } : null);
      }, 400);
    };
    const out = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest?.('a[href^="wiki:"]');
      if (link && link.contains(e.relatedTarget as Node | null)) return;
      clearTimeout(timer);
      setShown(null);
    };
    const hide = () => {
      clearTimeout(timer);
      setShown(null);
    };
    dom.addEventListener('mouseover', over);
    dom.addEventListener('mouseout', out);
    dom.addEventListener('keydown', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      clearTimeout(timer);
      dom.removeEventListener('mouseover', over);
      dom.removeEventListener('mouseout', out);
      dom.removeEventListener('keydown', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [editor, summaryOf]);
  if (!shown) return null;
  return createPortal(
    <div
      role="tooltip"
      className={pageCardClass}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(shown.x, window.innerWidth - 320)),
        top: shown.y,
      }}
    >
      <PageCard summary={shown.summary} />
    </div>,
    document.body,
  );
}
