import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CloudDownload,
  Download,
  FileText,
  Maximize2,
  RectangleHorizontal,
  Subtitles,
  Trash2,
  Type,
} from 'lucide-react';
import { useContext, useRef, useState, type PointerEvent } from 'react';
import { IconButton, Popover, PopoverContent, PopoverTrigger, toast } from '../components/ui';
import { floatingPanel } from '../components/ui/styles';
import { cn } from '../lib/cn';
import { useFileSrc } from '../markdown/context';
import { ImageViewer } from '../markdown/ImageViewer';
import type { ImageAlign } from './schema';
import { RichViewHostContext } from './viewHost';

/*
 * How images and attached files look in a rich page (§9.5): images can be resized by their
 * corner, aligned, captioned, given alt text and opened full size; files are cards to
 * download. An image still pointing at a website (its download failed) says so and can be
 * downloaded again.
 */

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

const ALIGNS: { value: ImageAlign; label: string; icon: React.ReactNode }[] = [
  { value: 'left', label: 'Left, text beside it', icon: <AlignLeft /> },
  { value: 'center', label: 'Centred', icon: <AlignCenter /> },
  { value: 'right', label: 'Right, text beside it', icon: <AlignRight /> },
  { value: 'inline', label: 'In line with the text', icon: <RectangleHorizontal /> },
];

export function ImageView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
}: ReactNodeViewProps) {
  const attrs = node.attrs as {
    src: string | null;
    alt: string;
    title: string | null;
    width: number | null;
    align: ImageAlign;
    caption: string;
  };
  const host = useContext(RichViewHostContext);
  const src = attrs.src ?? '';
  const remote = /^https?:/i.test(src);
  const url = useFileSrc(remote ? undefined : src);
  const [viewing, setViewing] = useState(false);
  const [captioning, setCaptioning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const editable = editor.isEditable;

  const resize = (side: 'left' | 'right', event: PointerEvent<HTMLSpanElement>) => {
    const box = frame.current;
    if (!box) return;
    event.preventDefault();
    const start = event.clientX;
    const from = box.getBoundingClientRect().width;
    const max = box.closest('.ProseMirror')?.getBoundingClientRect().width ?? 2000;
    let width = from;
    const move = (e: globalThis.PointerEvent) => {
      const delta = side === 'right' ? e.clientX - start : start - e.clientX;
      // Centred images grow on both sides.
      width = Math.round(
        Math.min(max, Math.max(48, from + delta * (attrs.align === 'center' ? 2 : 1))),
      );
      box.style.width = `${width}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      updateAttributes({ width });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const download = () => {
    setDownloading(true);
    host
      .downloadImage(src)
      .then((asset) => updateAttributes({ src: asset }))
      .catch((error: unknown) =>
        toast({
          title: 'Couldn’t download the image',
          description: error instanceof Error ? error.message : undefined,
          tone: 'error',
        }),
      )
      .finally(() => setDownloading(false));
  };

  const showCaption = !!attrs.caption || captioning;
  return (
    <NodeViewWrapper
      as="figure"
      className={cn('rich-image', selected && 'is-selected')}
      data-align={attrs.align}
    >
      <div
        ref={frame}
        className="rich-image-frame"
        style={attrs.width ? { width: `${attrs.width}px` } : undefined}
        data-drag-handle
      >
        {remote ? (
          <div className="rich-image-remote">
            <p>
              Image from <b>{hostOf(src)}</b>, not kept in this page yet.
            </p>
            {editable && (
              <button type="button" onClick={download} disabled={downloading}>
                <CloudDownload aria-hidden /> {downloading ? 'Downloading…' : 'Download it'}
              </button>
            )}
          </div>
        ) : (
          <img
            src={url}
            alt={attrs.alt}
            title={attrs.title ?? undefined}
            draggable={false}
            onDoubleClick={() => setViewing(true)}
          />
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
        {selected && (
          <div
            className={cn(floatingPanel, 'rich-image-tools flex items-center gap-0.5 p-1')}
            role="toolbar"
            aria-label="Image"
            contentEditable={false}
          >
            {editable &&
              ALIGNS.map((a) => (
                <IconButton
                  key={a.value}
                  label={a.label}
                  icon={a.icon}
                  size="sm"
                  active={attrs.align === a.value}
                  onMouseDown={keepFocus}
                  onClick={() => updateAttributes({ align: a.value })}
                />
              ))}
            {editable && (
              <>
                <AltText value={attrs.alt} onChange={(alt) => updateAttributes({ alt })} />
                <IconButton
                  label={showCaption ? 'Remove the caption' : 'Add a caption'}
                  icon={<Subtitles />}
                  size="sm"
                  active={showCaption}
                  onMouseDown={keepFocus}
                  onClick={() => {
                    if (showCaption) {
                      setCaptioning(false);
                      updateAttributes({ caption: '' });
                    } else setCaptioning(true);
                  }}
                />
              </>
            )}
            {!remote && (
              <IconButton
                label="Open full size"
                icon={<Maximize2 />}
                size="sm"
                onMouseDown={keepFocus}
                onClick={() => setViewing(true)}
              />
            )}
            {editable && (
              <IconButton
                label="Delete image"
                icon={<Trash2 />}
                size="sm"
                onMouseDown={keepFocus}
                onClick={deleteNode}
              />
            )}
          </div>
        )}
      </div>
      {showCaption && (
        <figcaption>
          {editable ? (
            <input
              aria-label="Caption"
              placeholder="Caption"
              value={attrs.caption}
              autoFocus={captioning && !attrs.caption}
              onChange={(e) => updateAttributes({ caption: e.target.value })}
              onBlur={() => setCaptioning(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  editor.commands.focus();
                }
              }}
            />
          ) : (
            attrs.caption
          )}
        </figcaption>
      )}
      <ImageViewer
        open={viewing}
        onOpenChange={setViewing}
        url={url}
        alt={attrs.alt}
        title={attrs.caption || undefined}
      />
    </NodeViewWrapper>
  );
}

function AltText({ value, onChange }: { value: string; onChange: (alt: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setText(value);
        else if (text !== value) onChange(text.trim());
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <IconButton
          label="Alt text"
          icon={<Type />}
          size="sm"
          active={!!value}
          onMouseDown={keepFocus}
        />
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Alt text</span>
          <span className="text-xs text-fg-2">
            Describes the image for screen readers, and when it can’t be shown.
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            maxLength={500}
            className="rounded-sm border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </label>
      </PopoverContent>
    </Popover>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return 'the web';
  }
};

const sizeLabel = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export function FileView({ node, selected }: ReactNodeViewProps) {
  const attrs = node.attrs as { src: string | null; name: string | null; size: number | null };
  const url = useFileSrc(attrs.src ?? undefined);
  const name = attrs.name ?? 'File';
  return (
    <NodeViewWrapper className={cn('rich-file', selected && 'is-selected')} data-drag-handle>
      <FileText aria-hidden className="rich-file-icon" />
      <span className="rich-file-name">
        {name}
        {attrs.size ? <span className="rich-file-size">{sizeLabel(attrs.size)}</span> : null}
      </span>
      <a href={url} download={name} className="rich-file-download" contentEditable={false}>
        <Download aria-hidden /> Download
      </a>
    </NodeViewWrapper>
  );
}
