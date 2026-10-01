import { ASSET_SCHEME, RICH_MAX_INDENT, type RichMark, type RichNode } from '@memora/shared';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import { assetsIn, fetchAsset, type ExportDocument } from './document';

/*
 * Word export (§9.10): each rich block becomes its Word counterpart, with Word's own heading,
 * list and hyperlink styles, so the file reads and edits well in Word and LibreOffice.
 * Pages of a section each start on a new page under their title.
 */

interface Picture {
  type: 'png' | 'jpg' | 'gif' | 'bmp';
  data: ArrayBuffer;
  width: number;
  height: number;
}

/** Usable width of an A4/Letter page with Word's default margins, in pixels. */
const MAX_WIDTH = 600;
const MONO = 'Consolas';
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
] as const;
const ALIGN = {
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
} as const;
const CALLOUT_COLOR: Record<string, string> = {
  note: '0969DA',
  tip: '1A7F37',
  important: '8250DF',
  warning: '9A6700',
  caution: 'CF222E',
};

async function measure(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 400, height: 300 };
  }
}

/** Word takes PNG, JPEG, GIF and BMP; other images are drawn into a PNG first. */
async function picture(blob: Blob): Promise<Picture | null> {
  const size = await measure(blob);
  const direct = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
  } as const;
  const type = direct[blob.type as keyof typeof direct];
  if (type) return { type, data: await blob.arrayBuffer(), ...size };
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await canvas.convertToBlob({ type: 'image/png' });
    return { type: 'png', data: await png.arrayBuffer(), ...size };
  } catch {
    return null;
  }
}

const textOf = (node: RichNode): string =>
  node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(textOf).join('');

class Writer {
  private lists = 0;

  constructor(private readonly pictures: Map<string, Picture>) {}

  private runs(nodes: RichNode[] | undefined, base: IRunOptions = {}): ParagraphChild[] {
    const out: ParagraphChild[] = [];
    for (const node of nodes ?? []) {
      if (node.type === 'hardBreak') {
        out.push(new TextRun({ ...base, text: '', break: 1 }));
        continue;
      }
      if (node.type === 'inlineMath') {
        out.push(new TextRun({ ...base, text: String(node.attrs?.latex ?? ''), font: MONO }));
        continue;
      }
      if (node.type !== 'text') {
        out.push(...this.runs(node.content, base));
        continue;
      }
      const options: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = {
        ...base,
        text: node.text ?? '',
      };
      let href: string | null = null;
      for (const mark of node.marks ?? ([] as RichMark[])) {
        switch (mark.type) {
          case 'bold':
            options.bold = true;
            break;
          case 'italic':
            options.italics = true;
            break;
          case 'strike':
            options.strike = true;
            break;
          case 'underline':
            options.underline = {};
            break;
          case 'code':
            options.font = MONO;
            options.shading = { type: ShadingType.CLEAR, fill: 'EFF1F3', color: 'auto' };
            break;
          case 'subscript':
            options.subScript = true;
            break;
          case 'superscript':
            options.superScript = true;
            break;
          case 'highlight':
            options.highlight = 'yellow';
            break;
          case 'textStyle': {
            const color = mark.attrs?.color;
            if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
              options.color = color.slice(1);
            break;
          }
          case 'link': {
            const target = mark.attrs?.href;
            if (typeof target === 'string' && /^(https?:|mailto:)/i.test(target)) href = target;
            break;
          }
        }
      }
      if (href) {
        out.push(
          new ExternalHyperlink({
            link: href,
            children: [new TextRun({ ...options, style: 'Hyperlink' })],
          }),
        );
      } else {
        out.push(new TextRun(options));
      }
    }
    return out;
  }

  private paragraph(node: RichNode, options: IParagraphOptions = {}): Paragraph {
    const align = node.attrs?.textAlign;
    // Indent steps as Word's own: half an inch (720 twips) each.
    const indent = Number(node.attrs?.indent);
    return new Paragraph({
      ...options,
      ...(typeof align === 'string' && align in ALIGN
        ? { alignment: ALIGN[align as keyof typeof ALIGN] }
        : {}),
      ...(Number.isInteger(indent) && indent > 0 && indent <= RICH_MAX_INDENT
        ? { indent: { left: indent * 720 } }
        : {}),
      children: [
        ...((options.children as ParagraphChild[] | undefined) ?? []),
        ...this.runs(node.content),
      ],
    });
  }

  private image(node: RichNode, options: IParagraphOptions): (Paragraph | Table)[] {
    const src = node.attrs?.src;
    const found =
      typeof src === 'string' && src.startsWith(ASSET_SCHEME)
        ? this.pictures.get(src.slice(ASSET_SCHEME.length))
        : undefined;
    const caption = typeof node.attrs?.caption === 'string' ? node.attrs.caption : '';
    if (!found) {
      const alt = typeof node.attrs?.alt === 'string' && node.attrs.alt ? node.attrs.alt : 'Image';
      return [
        new Paragraph({ ...options, children: [new TextRun({ text: `[${alt}]`, italics: true })] }),
      ];
    }
    const wanted = Number(node.attrs?.width) > 0 ? Number(node.attrs?.width) : found.width;
    const width = Math.min(wanted, MAX_WIDTH);
    const height = Math.round((found.height / Math.max(found.width, 1)) * width);
    const out: Paragraph[] = [
      new Paragraph({
        ...options,
        children: [
          new ImageRun({
            type: found.type,
            data: found.data,
            transformation: { width, height },
            altText: { name: 'Image', title: caption, description: String(node.attrs?.alt ?? '') },
          }),
        ],
      }),
    ];
    if (caption) out.push(new Paragraph({ style: 'Caption', children: [new TextRun(caption)] }));
    return out;
  }

  private table(node: RichNode): Table {
    const rows = (node.content ?? []).map(
      (row, r) =>
        new TableRow({
          tableHeader: r === 0 && (row.content ?? []).every((c) => c.type === 'tableHeader'),
          children: (row.content ?? []).map((cell) => {
            const header = cell.type === 'tableHeader';
            const blocks = this.blocks(cell.content ?? [], {});
            return new TableCell({
              columnSpan: Number(cell.attrs?.colspan ?? 1) || 1,
              rowSpan: Number(cell.attrs?.rowspan ?? 1) || 1,
              ...(header
                ? { shading: { type: ShadingType.CLEAR, fill: 'F2F4F7', color: 'auto' } }
                : {}),
              children: blocks.length ? blocks : [new Paragraph('')],
            });
          }),
        }),
    );
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
  }

  private list(node: RichNode, level: number): (Paragraph | Table)[] {
    const kind = node.type;
    const instance = (this.lists += 1);
    const inside: IParagraphOptions = { indent: { left: 720 * (level + 1) } };
    const out: (Paragraph | Table)[] = [];
    for (const item of node.content ?? []) {
      let first = true;
      for (const child of item.content ?? []) {
        if (
          child.type === 'bulletList' ||
          child.type === 'orderedList' ||
          child.type === 'taskList'
        ) {
          out.push(...this.list(child, Math.min(level + 1, 8)));
        } else if (child.type === 'paragraph' && first) {
          // The item's first paragraph carries its bullet, number or box.
          const marker: IParagraphOptions =
            kind === 'orderedList'
              ? { numbering: { reference: 'ordered', level, instance } }
              : kind === 'taskList'
                ? { indent: { left: 720 * (level + 1), hanging: 360 } }
                : { bullet: { level } };
          const box = kind === 'taskList' ? [new TextRun(item.attrs?.checked ? '☒ ' : '☐ ')] : [];
          out.push(this.paragraph(child, { ...marker, children: box }));
        } else {
          out.push(...this.blocks([child], inside));
        }
        first = false;
      }
    }
    return out;
  }

  blocks(nodes: RichNode[], options: IParagraphOptions): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [];
    for (const node of nodes) {
      switch (node.type) {
        case 'paragraph':
          out.push(this.paragraph(node, options));
          break;
        case 'heading': {
          const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
          out.push(this.paragraph(node, { ...options, heading: HEADINGS[level - 1] }));
          break;
        }
        case 'bulletList':
        case 'orderedList':
        case 'taskList':
          out.push(...this.list(node, 0));
          break;
        case 'blockquote':
          out.push(
            ...this.blocks(node.content ?? [], {
              ...options,
              indent: { left: 567 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'D0D7DE', space: 12 } },
            }),
          );
          break;
        case 'callout': {
          const kind = typeof node.attrs?.kind === 'string' ? node.attrs.kind : 'note';
          out.push(
            ...this.blocks(node.content ?? [], {
              ...options,
              shading: { type: ShadingType.CLEAR, fill: 'F6F8FA', color: 'auto' },
              border: {
                left: {
                  style: BorderStyle.SINGLE,
                  size: 24,
                  color: CALLOUT_COLOR[kind] ?? '0969DA',
                  space: 8,
                },
              },
            }),
          );
          break;
        }
        case 'codeBlock': {
          const lines = textOf(node).split('\n');
          out.push(
            new Paragraph({
              ...options,
              shading: { type: ShadingType.CLEAR, fill: 'F6F8FA', color: 'auto' },
              children: lines.map(
                (line, i) => new TextRun({ text: line, font: MONO, size: 19, break: i ? 1 : 0 }),
              ),
            }),
          );
          break;
        }
        case 'blockMath':
          out.push(
            new Paragraph({
              ...options,
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: String(node.attrs?.latex ?? ''), font: MONO })],
            }),
          );
          break;
        case 'horizontalRule':
          out.push(
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D0D7DE', space: 1 } },
            }),
          );
          break;
        case 'image':
          out.push(...this.image(node, options));
          break;
        case 'file':
          out.push(
            new Paragraph({
              ...options,
              children: [
                new TextRun({ text: `📎 ${String(node.attrs?.name ?? 'File')}`, italics: true }),
              ],
            }),
          );
          break;
        case 'table':
          out.push(this.table(node));
          break;
        default:
          if (node.content) out.push(...this.blocks(node.content, options));
      }
    }
    return out;
  }
}

export async function docxFile(document: ExportDocument): Promise<Blob> {
  const pictures = new Map<string, Picture>();
  for (const id of assetsIn(document)) {
    const blob = await fetchAsset(id);
    const found = blob && blob.type.startsWith('image/') ? await picture(blob) : null;
    if (found) pictures.set(id, found);
  }
  const writer = new Writer(pictures);
  const single = document.pages.length === 1;
  const children: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(document.title)] }),
  ];
  document.pages.forEach((page, i) => {
    if (!single) {
      children.push(
        new Paragraph({
          heading: HEADINGS[Math.min(page.depth - 1, 5)],
          pageBreakBefore: i > 0 && page.depth === 1,
          children: [new TextRun(page.title || 'Untitled page')],
        }),
      );
    }
    children.push(...writer.blocks(page.doc.content ?? [], {}));
  });
  const doc = new Document({
    creator: 'Memora',
    title: document.title,
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
    },
    numbering: {
      config: [
        {
          reference: 'ordered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][
              level % 3
            ]!,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
