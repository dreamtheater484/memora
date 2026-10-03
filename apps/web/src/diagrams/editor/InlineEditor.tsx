import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { TextSpec } from './labels';

/*
 * Editing words in place on the drawing (§9.4): a field over the item's words, as wide as
 * they are (and growing as they are typed), at the drawing's zoom. Enter keeps the words,
 * Shift+Enter breaks a line where labels can have several, Tab keeps them and goes on (the
 * next box, a child topic, a reply…), Esc leaves the words as they were. Clicking elsewhere
 * keeps them too.
 */

export type EditEnd = 'enter' | 'tab' | 'shift-tab' | 'blur';

interface Props {
  /** Where the words are, on the canvas. */
  rect: DOMRect;
  /** The canvas's size: the field stays inside it. */
  bounds: { width: number; height: number };
  scale: number;
  spec: TextSpec;
  /** Typed to start editing: it replaces the words. */
  typed?: string;
  /** The cursor goes to the end instead of selecting the words. */
  caretAtEnd?: boolean;
  onCommit: (text: string, end: EditEnd) => void;
  onCancel: () => void;
}

let measurer: CanvasRenderingContext2D | null = null;
function textWidth(text: string, font: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return text.length * 8;
  measurer.font = font;
  return Math.max(...text.split('\n').map((line) => measurer!.measureText(line || ' ').width));
}

export function InlineEditor({
  rect,
  bounds,
  scale,
  spec,
  typed,
  caretAtEnd,
  onCommit,
  onCancel,
}: Props) {
  const [text, setText] = useState(typed ?? spec.text);
  const area = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const latest = useRef({ onCommit, onCancel, text });
  useLayoutEffect(() => {
    latest.current = { onCommit, onCancel, text };
  });

  const finish = (end: EditEnd) => {
    if (done.current) return;
    done.current = true;
    latest.current.onCommit(latest.current.text, end);
  };

  // Esc is caught before the dialog sees it (it would close the field by moving the focus
  // away, which keeps the words): here it leaves them as they were.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.activeElement !== area.current) return;
      e.preventDefault();
      e.stopPropagation();
      if (done.current) return;
      done.current = true;
      latest.current.onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useLayoutEffect(() => {
    const field = area.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    if (typed !== undefined || caretAtEnd)
      field.setSelectionRange(field.value.length, field.value.length);
    else field.select();
    // Placed once; what is typed then only changes its size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fontSize = Math.max(12, Math.min(20, 15 * scale));
  const font = `500 ${fontSize}px "Figtree Variable", Figtree, system-ui, sans-serif`;
  const lines = Math.max(1, text.split('\n').length);
  const width = Math.min(
    bounds.width - 16,
    Math.max(rect.width + 16, 120, textWidth(text, font) + 34),
  );
  const height = lines * Math.round(fontSize * 1.35) + 16;
  const left = Math.min(Math.max(8, rect.x + rect.width / 2 - width / 2), bounds.width - width - 8);
  const top = Math.min(
    Math.max(8, rect.y + rect.height / 2 - height / 2),
    Math.max(8, bounds.height - height - 8),
  );

  return (
    <textarea
      ref={area}
      className="diagram-overlay-control diagram-label-input"
      aria-label={spec.label}
      rows={lines}
      wrap="off"
      spellCheck
      inputMode={spec.numeric ? 'decimal' : undefined}
      value={text}
      onChange={(e) =>
        setText(spec.multiline ? e.target.value : e.target.value.replace(/\r?\n/g, ' '))
      }
      onBlur={() => finish('blur')}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !(e.shiftKey && spec.multiline)) {
          e.preventDefault();
          finish('enter');
        } else if (e.key === 'Tab') {
          e.preventDefault();
          finish(e.shiftKey ? 'shift-tab' : 'tab');
        }
      }}
      style={{ left, top, width, height, fontSize, lineHeight: `${Math.round(fontSize * 1.35)}px` }}
    />
  );
}
