import type { EditorView } from '@codemirror/view';
import { useEffect } from 'react';

/*
 * Split view scroll sync (§9.3): the source line at the top of the editor and the rendered
 * block that came from it line up, whichever side you scroll. Blocks carry their source line
 * (`data-line`); between two blocks the position is interpolated.
 */

interface Anchor {
  line: number;
  top: number;
}

/** Rendered blocks with their source line and offset in the scroller, in page order. */
function anchors(scroller: HTMLElement): Anchor[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const list: Anchor[] = [];
  for (const el of scroller.querySelectorAll<HTMLElement>('[data-line]')) {
    const line = Number(el.dataset.line);
    const top = el.getBoundingClientRect().top - base;
    // Keep the outermost block per line, and lines in increasing order.
    if (list.length && line <= list[list.length - 1]!.line) continue;
    list.push({ line, top });
  }
  return list;
}

/** Fractional source line → offset in the preview. */
function previewOffset(list: Anchor[], line: number): number {
  if (!list.length) return 0;
  let i = list.findIndex((a) => a.line > line);
  if (i === 0) return 0;
  if (i < 0) i = list.length;
  const before = list[i - 1]!;
  const after = list[i];
  if (!after) return before.top;
  const ratio = (line - before.line) / (after.line - before.line);
  return before.top + ratio * (after.top - before.top);
}

/** Offset in the preview → fractional source line. */
function sourceLine(list: Anchor[], offset: number): number {
  if (!list.length) return 1;
  let i = list.findIndex((a) => a.top > offset);
  if (i === 0) return list[0]!.line;
  if (i < 0) i = list.length;
  const before = list[i - 1]!;
  const after = list[i];
  if (!after) return before.line;
  const ratio = (offset - before.top) / Math.max(1, after.top - before.top);
  return before.line + ratio * (after.line - before.line);
}

/** The source line (fractional) at the top of the editor's viewport. */
function topLine(view: EditorView): number {
  const scroller = view.scrollDOM;
  const block = view.lineBlockAtHeight(scroller.scrollTop - view.documentPadding.top);
  const line = view.state.doc.lineAt(block.from).number;
  return line + Math.max(0, (scroller.scrollTop - block.top) / Math.max(1, block.height));
}

export function useScrollSync(
  view: EditorView | null,
  preview: HTMLElement | null,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || !view || !preview) return;
    const editorScroller = view.scrollDOM;
    // Block positions, measured once and kept until the preview's content or size changes:
    // measuring every block on every scroll event would drop frames on long pages.
    let cache: Anchor[] | null = null;
    const list = () => (cache ??= anchors(preview));
    const forget = () => {
      cache = null;
    };
    const mutations = new MutationObserver(forget);
    mutations.observe(preview, { childList: true, subtree: true, characterData: true });
    // Images loading and wrapping changes move blocks without changing the DOM.
    const sizes = new ResizeObserver(forget);
    sizes.observe(preview);
    if (preview.firstElementChild) sizes.observe(preview.firstElementChild);

    // Which side the user is scrolling: the other side follows, without echoing back.
    let driver: 'editor' | 'preview' | null = null;
    let release: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const lead = (side: 'editor' | 'preview') => {
      driver = side;
      clearTimeout(release);
      release = setTimeout(() => (driver = null), 150);
    };
    const followEditor = () => {
      const line = topLine(view);
      preview.scrollTop = line <= 1.01 ? 0 : previewOffset(list(), line);
    };
    const followPreview = () => {
      if (preview.scrollTop <= 0) {
        editorScroller.scrollTop = 0;
        return;
      }
      const line = sourceLine(list(), preview.scrollTop);
      const whole = Math.min(view.state.doc.lines, Math.max(1, Math.floor(line)));
      const block = view.lineBlockAt(view.state.doc.line(whole).from);
      editorScroller.scrollTop = block.top + (line - whole) * block.height;
    };
    // At most once per frame, whatever the number of scroll events.
    const schedule = (side: 'editor' | 'preview') => {
      if (driver && driver !== side) return;
      lead(side);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (driver === 'editor') followEditor();
        else if (driver === 'preview') followPreview();
      });
    };
    const onEditor = () => schedule('editor');
    const onPreview = () => schedule('preview');
    editorScroller.addEventListener('scroll', onEditor, { passive: true });
    preview.addEventListener('scroll', onPreview, { passive: true });
    return () => {
      clearTimeout(release);
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      editorScroller.removeEventListener('scroll', onEditor);
      preview.removeEventListener('scroll', onPreview);
    };
  }, [view, preview, enabled]);
}

/** Scrolls the preview so the block from `line` is at the top. */
export function scrollPreviewTo(preview: HTMLElement, line: number): void {
  const list = anchors(preview);
  preview.scrollTo({ top: Math.max(0, previewOffset(list, line) - 8), behavior: 'smooth' });
}
