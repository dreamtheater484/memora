import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ClipboardCopy,
  PenLine,
  Ruler,
  Subtitles,
  Trash2,
} from 'lucide-react';
import { useRef, useState, type PointerEvent } from 'react';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
  toast,
} from '../components/ui';
import { floatingPanel } from '../components/ui/styles';
import { DrawnDiagram } from '../diagrams/DrawnDiagram';
import { cn } from '../lib/cn';
import type { DiagramAlign } from './diagram';
import { editDiagramAt } from './diagramActions';

/*
 * How a diagram looks in a rich page (§9.4): drawn, with a toolbar when selected (edit, size,
 * alignment, caption, copy as an image, delete), resized by its sides, and opened in the
 * diagram editor by a double-click or Enter.
 */

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

const ALIGNS: { value: DiagramAlign; label: string; icon: React.ReactNode }[] = [
  { value: 'left', label: 'Align left', icon: <AlignLeft /> },
  { value: 'center', label: 'Centre', icon: <AlignCenter /> },
  { value: 'right', label: 'Align right', icon: <AlignRight /> },
];

const SIZES: { value: string; label: string; width: number | null }[] = [
  { value: 'natural', label: 'Natural size', width: null },
  { value: '320', label: 'Small', width: 320 },
  { value: '480', label: 'Medium', width: 480 },
  { value: '720', label: 'Large', width: 720 },
];

export interface DiagramBlockProps {
  node: PMNode;
  editor: Editor;
  getPos: () => number | undefined;
  selected: boolean;
}

export function DiagramBlock({ node, editor, getPos, selected }: DiagramBlockProps) {
  const attrs = node.attrs as {
    width: number | null;
    align: DiagramAlign | null;
    caption: string | null;
  };
  const code = node.textContent;
  const editable = editor.isEditable;
  const frame = useRef<HTMLDivElement>(null);
  const [captioning, setCaptioning] = useState(false);
  const align = attrs.align ?? 'center';

  const pos = () => getPos() ?? null;
  const update = (changes: Partial<typeof attrs>) => {
    const at = pos();
    if (at === null) return;
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeMarkup(at, undefined, { ...node.attrs, ...changes });
        tr.setSelection(NodeSelection.create(tr.doc, at));
        return true;
      })
      .run();
  };
  const select = () => {
    const at = pos();
    if (at !== null) editor.chain().focus().setNodeSelection(at).run();
  };
  const edit = () => {
    const at = pos();
    if (at !== null && editable) editDiagramAt(editor, at);
  };
  const remove = () => {
    const at = pos();
    if (at !== null)
      editor
        .chain()
        .focus()
        .deleteRange({ from: at, to: at + node.nodeSize })
        .run();
  };
  const copy = async () => {
    try {
      const { renderForExport, svgToPng } = await import('../diagrams/render');
      const png = await svgToPng(await renderForExport(code));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      toast({ title: 'Diagram copied as an image', tone: 'success' });
    } catch {
      toast({ title: 'Couldn’t copy the diagram', tone: 'error' });
    }
  };

  const resize = (side: 'left' | 'right', event: PointerEvent<HTMLSpanElement>) => {
    const box = frame.current;
    if (!box) return;
    event.preventDefault();
    event.stopPropagation();
    const start = event.clientX;
    const from = box.getBoundingClientRect().width;
    const max = box.closest('.ProseMirror')?.getBoundingClientRect().width ?? 2000;
    let width = from;
    const move = (e: globalThis.PointerEvent) => {
      const delta = side === 'right' ? e.clientX - start : start - e.clientX;
      width = Math.round(Math.min(max, Math.max(120, from + delta * (align === 'center' ? 2 : 1))));
      box.style.width = `${width}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      update({ width });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const showCaption = !!attrs.caption || captioning;
  const size = SIZES.find((s) => s.width === attrs.width)?.value ?? 'custom';
  return (
    <figure className={cn('rich-diagram', selected && 'is-selected')} data-align={align}>
      <div
        ref={frame}
        className="rich-diagram-frame"
        style={attrs.width ? { width: `${attrs.width}px` } : undefined}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('[role="toolbar"], button, input')) return;
          e.preventDefault();
          select();
        }}
        onDoubleClick={edit}
        data-drag-handle
      >
        {code.trim() ? (
          <DrawnDiagram
            code={code}
            label={attrs.caption ?? undefined}
            failed={(message) => (
              <div className="rich-diagram-empty">
                <p>The diagram has a mistake: {message}</p>
                {editable && (
                  <button type="button" onClick={edit}>
                    <PenLine aria-hidden /> Edit diagram
                  </button>
                )}
              </div>
            )}
          />
        ) : (
          <div className="rich-diagram-empty">
            <p>An empty diagram.</p>
            {editable && (
              <button type="button" onClick={edit}>
                <PenLine aria-hidden /> Edit diagram
              </button>
            )}
          </div>
        )}
        {selected && editable && (
          <>
            <span
              className="rich-image-resize left"
              onPointerDown={(e) => resize('left', e)}
              aria-hidden
            />
            <span
              className="rich-image-resize right"
              onPointerDown={(e) => resize('right', e)}
              aria-hidden
            />
          </>
        )}
        {selected && editable && (
          <div
            className={cn(floatingPanel, 'rich-image-tools flex items-center gap-0.5 p-1')}
            role="toolbar"
            aria-label="Diagram"
          >
            <IconButton
              label="Edit diagram"
              icon={<PenLine />}
              size="sm"
              shortcut="Enter"
              onMouseDown={keepFocus}
              onClick={edit}
            />
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Size" icon={<Ruler />} size="sm" onMouseDown={keepFocus} />
              </MenuTrigger>
              <MenuContent align="center" onCloseAutoFocus={(e) => e.preventDefault()}>
                <MenuRadioGroup
                  value={size}
                  onValueChange={(value) =>
                    update({ width: SIZES.find((s) => s.value === value)?.width ?? null })
                  }
                >
                  {SIZES.map((s) => (
                    <MenuRadioItem key={s.value} value={s.value}>
                      {s.label}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuContent>
            </Menu>
            {ALIGNS.map((a) => (
              <IconButton
                key={a.value}
                label={a.label}
                icon={a.icon}
                size="sm"
                active={align === a.value}
                onMouseDown={keepFocus}
                onClick={() => update({ align: a.value === 'center' ? null : a.value })}
              />
            ))}
            <IconButton
              label={showCaption ? 'Remove the caption' : 'Add a caption'}
              icon={<Subtitles />}
              size="sm"
              active={showCaption}
              onMouseDown={keepFocus}
              onClick={() => {
                if (showCaption) {
                  setCaptioning(false);
                  update({ caption: null });
                } else setCaptioning(true);
              }}
            />
            <IconButton
              label="Copy as an image"
              icon={<ClipboardCopy />}
              size="sm"
              onMouseDown={keepFocus}
              onClick={() => void copy()}
            />
            <IconButton
              label="Delete diagram"
              icon={<Trash2 />}
              size="sm"
              onMouseDown={keepFocus}
              onClick={remove}
            />
          </div>
        )}
      </div>
      {showCaption && (
        <figcaption>
          {editable ? (
            <input
              aria-label="Caption"
              placeholder="Caption"
              defaultValue={attrs.caption ?? ''}
              autoFocus={captioning && !attrs.caption}
              onBlur={(e) => {
                setCaptioning(false);
                const value = e.target.value.trim();
                if (value !== (attrs.caption ?? '')) update({ caption: value || null });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                  editor.commands.focus();
                }
              }}
            />
          ) : (
            attrs.caption
          )}
        </figcaption>
      )}
    </figure>
  );
}
