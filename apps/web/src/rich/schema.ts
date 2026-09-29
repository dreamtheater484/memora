import { CALLOUT_KINDS, RICH_LINE_SPACINGS, type CalloutKind } from '@memora/shared';
import {
  Extension,
  Node,
  mergeAttributes,
  type AnyExtension,
  type NodeViewRenderer,
} from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import {
  BackgroundColor,
  Color,
  FontFamily,
  FontSize,
  TextStyle,
} from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';

/*
 * The rich page schema (§8.3, §9.4): every node and mark a rich page can hold. The same list
 * reads HTML (paste, conversion from Markdown) and writes it, with or without an editor; the
 * editor adds its views and helpers on top (editorExtensions in RichEditor).
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the selected blocks in a callout box, or changes its kind. */
      setCallout: (kind: CalloutKind) => ReturnType;
      unsetCallout: () => ReturnType;
    };
    lineSpacing: {
      setLineSpacing: (spacing: number | null) => ReturnType;
    };
    fileBlock: {
      insertFile: (attrs: FileAttrs) => ReturnType;
    };
  }
}

export interface FileAttrs {
  src: string;
  name: string;
  size?: number | null;
  mime?: string | null;
}

export type ImageAlign = 'left' | 'center' | 'right' | 'inline';

/** Addresses a rich page may point images at: its own files, or (until downloaded) the web. */
const IMAGE_SRC = /^(asset:|https?:|data:image\/(png|jpeg|gif|webp|avif);base64,)/i;

/** A `> [!NOTE]` box: a kind and any blocks. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      kind: {
        default: 'note' satisfies CalloutKind,
        parseHTML: (element) => {
          const kind =
            element.getAttribute('data-kind') ??
            /markdown-alert-(\w+)/.exec(element.className)?.[1] ??
            'note';
          return CALLOUT_KINDS.includes(kind as CalloutKind) ? kind : 'note';
        },
        renderHTML: (attributes) => ({ 'data-kind': attributes.kind }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }, { tag: 'div.markdown-alert' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        class: `markdown-alert markdown-alert-${node.attrs.kind as string}`,
      }),
      0,
    ];
  },
  addCommands() {
    return {
      setCallout:
        (kind) =>
        ({ commands, editor }) =>
          editor.isActive(this.name)
            ? commands.updateAttributes(this.name, { kind })
            : commands.wrapIn(this.name, { kind }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },
});

/** An attached file (a PDF, say), shown as a card to download. */
export const FileBlock = Node.create({
  name: 'file',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    const data = (name: string, parse: (v: string | null) => unknown = (v) => v) => ({
      default: null,
      parseHTML: (element: HTMLElement) => parse(element.getAttribute(`data-${name}`)),
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes[name] == null ? {} : { [`data-${name}`]: String(attributes[name]) },
    });
    return {
      src: data('src'),
      name: data('name'),
      size: data('size', (v) => (v ? Number(v) : null)),
      mime: data('mime'),
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="file"]' }];
  },
  renderHTML({ HTMLAttributes, node }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'file' }),
      String(node.attrs.name ?? 'File'),
    ];
  },
  addCommands() {
    return {
      insertFile:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

/** Images with a width, an alignment and a caption; shown full size on request. */
export const RichImage = Image.extend({
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      src: {
        default: null,
        parseHTML: (element) => {
          const img = element.tagName === 'IMG' ? element : element.querySelector('img');
          const src = img?.getAttribute('src') ?? null;
          return src && IMAGE_SRC.test(src) ? src : null;
        },
      },
      alt: {
        default: '',
        parseHTML: (element) =>
          (element.tagName === 'IMG' ? element : element.querySelector('img'))?.getAttribute(
            'alt',
          ) ?? '',
      },
      title: {
        default: null,
        parseHTML: (element) =>
          (element.tagName === 'IMG' ? element : element.querySelector('img'))?.getAttribute(
            'title',
          ) ?? null,
      },
      width: {
        default: null,
        parseHTML: (element) => {
          const img = element.tagName === 'IMG' ? element : element.querySelector('img');
          const value = Number.parseInt(img?.getAttribute('width') ?? '', 10);
          return Number.isFinite(value) && value > 0 ? value : null;
        },
        renderHTML: (attributes) => (attributes.width ? { width: attributes.width } : {}),
      },
      height: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
      align: {
        default: 'center' satisfies ImageAlign,
        parseHTML: (element) => {
          const align = element.getAttribute('data-align');
          return align === 'left' || align === 'right' || align === 'inline' ? align : 'center';
        },
        renderHTML: (attributes) => ({ 'data-align': attributes.align }),
      },
      caption: {
        default: '',
        parseHTML: (element) =>
          element.tagName === 'FIGURE'
            ? (element.querySelector('figcaption')?.textContent ?? '')
            : '',
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'figure',
        getAttrs: (element) => {
          const src = element.querySelector('img')?.getAttribute('src');
          return src && IMAGE_SRC.test(src) ? null : false;
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (element) => (IMAGE_SRC.test(element.getAttribute('src') ?? '') ? null : false),
      },
    ];
  },
  renderHTML({ HTMLAttributes, node }) {
    const { 'data-align': align, ...img } = HTMLAttributes as Record<string, unknown>;
    const caption = String(node.attrs.caption ?? '');
    return [
      'figure',
      { class: 'rich-image', 'data-align': align },
      ['img', img],
      ...(caption ? [['figcaption', caption]] : []),
    ];
  },
}).configure({ inline: false, allowBase64: true });

/** Line spacing on paragraphs and headings, as in Word (1 is single spacing). */
export const LineSpacing = Extension.create({
  name: 'lineSpacing',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          lineSpacing: {
            default: null,
            parseHTML: (element) => {
              const value = Number(element.getAttribute('data-line-spacing'));
              return (RICH_LINE_SPACINGS as readonly number[]).includes(value) ? value : null;
            },
            renderHTML: (attributes) =>
              attributes.lineSpacing
                ? {
                    'data-line-spacing': attributes.lineSpacing,
                    style: `line-height: ${(1.2 * Number(attributes.lineSpacing)).toFixed(2)}`,
                  }
                : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineSpacing:
        (spacing) =>
        ({ commands }) =>
          ['paragraph', 'heading']
            .map((type) => commands.updateAttributes(type, { lineSpacing: spacing }))
            .some(Boolean),
    };
  },
});

/** Table cells with a background colour. */
const cellColour = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      element.getAttribute('data-background-color') || element.style.backgroundColor || null,
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.backgroundColor
        ? {
            'data-background-color': attributes.backgroundColor,
            style: `background-color: ${String(attributes.backgroundColor)}`,
          }
        : {},
  },
};

export const RichTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellColour };
  },
});

export const RichTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellColour };
  },
});

/** Links may also point at pages (`wiki:`) and files (`asset:`). */
export const LINK_PROTOCOLS = ['wiki', 'asset'];

export interface RichSchemaOptions {
  /** How the editor shows images and files; without, they are plain HTML. */
  views?: { image?: NodeViewRenderer; file?: NodeViewRenderer };
  /** A formula was clicked, to edit it. */
  onMathClick?: (node: PMNode, pos: number) => void;
}

/** Every node and mark of a rich page. */
export function richExtensions(options: RichSchemaOptions = {}): AnyExtension[] {
  const { views = {}, onMathClick } = options;
  const katexOptions = { throwOnError: false, trust: false };
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        protocols: LINK_PROTOCOLS,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: null },
      },
      codeBlock: { languageClassPrefix: 'language-', defaultLanguage: null },
      // The editor adds its own (with the trailing paragraph and history settings).
      dropcursor: false,
      trailingNode: false,
    }),
    TextStyle,
    Color,
    BackgroundColor,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    LineSpacing,
    Subscript,
    Superscript,
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true, lastColumnResizable: false, cellMinWidth: 60 }),
    TableRow,
    RichTableHeader,
    RichTableCell,
    InlineMath.configure({ katexOptions, onClick: onMathClick }),
    BlockMath.configure({ katexOptions, onClick: onMathClick }),
    Callout,
    views.image ? RichImage.extend({ addNodeView: () => views.image! }) : RichImage,
    views.file ? FileBlock.extend({ addNodeView: () => views.file! }) : FileBlock,
  ];
}
