import { DIAGRAM_LANGUAGE, diagramText } from './diagrams';
import { escapeCell, formatTable, type Align } from './table';

/*
 * Rich pages (§8.3, §9.4): stored as TipTap/ProseMirror JSON. Files are referenced as
 * `asset:<id>`, never embedded. This module needs no editor or DOM, so the server can use it
 * too: plain text for search and snippets, and Markdown (for converting a page, and for
 * exports), with a report of what Markdown can't express.
 */

export interface RichMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: RichMark[];
  text?: string;
}

/** A page with nothing on it yet. */
export const EMPTY_RICH_DOC: RichNode = { type: 'doc', content: [{ type: 'paragraph' }] };

/** The kinds of callout box, as in Markdown's `> [!NOTE]` alerts. */
export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/**
 * The fonts on offer (§9.4): the stored value is the CSS font family. Each common font names
 * a look-alike that Linux has (Carlito for Calibri, Caladea for Cambria), then its kind.
 * Text can also have a font of the computer's own (the desktop app lists them).
 */
export const RICH_FONTS = [
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Monospace', value: '"JetBrains Mono Variable", ui-monospace, monospace' },
  { label: 'Display', value: '"Bricolage Grotesque Variable", sans-serif' },
  { label: 'Arial', value: 'Arial, "Liberation Sans", Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Carlito, sans-serif' },
  { label: 'Cambria', value: 'Cambria, Caladea, serif' },
  { label: 'Courier New', value: '"Courier New", "Liberation Mono", Courier, monospace' },
  { label: 'Georgia', value: 'Georgia, "DejaVu Serif", serif' },
  { label: 'Times New Roman', value: '"Times New Roman", "Liberation Serif", Times, serif' },
  { label: 'Verdana', value: 'Verdana, "DejaVu Sans", Geneva, sans-serif' },
] as const;
export type RichFontLabel = (typeof RICH_FONTS)[number]['label'];

/** A font on offer, by its name. */
export const richFont = (label: RichFontLabel): string =>
  RICH_FONTS.find((f) => f.label === label)!.value;

/** The name to show for a stored font family: its label, or the first family it names. */
export function richFontLabel(value: string): string {
  const known = RICH_FONTS.find((f) => f.value === value);
  if (known) return known.label;
  return (
    value
      .split(',')[0]!
      .trim()
      .replace(/^["']|["']$/g, '') || value
  );
}

/** Font sizes on offer, in points as in Word; text without one has the default size. */
export const RICH_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72] as const;

/** How far a paragraph can be indented with Tab, in steps of RICH_INDENT_EM. */
export const RICH_MAX_INDENT = 8;
export const RICH_INDENT_EM = 2;

/** Text colours, readable on the light and the dark theme. */
export const RICH_TEXT_COLORS = [
  { label: 'Grey', value: '#8b8d98' },
  { label: 'Red', value: '#e5484d' },
  { label: 'Orange', value: '#f76b15' },
  { label: 'Amber', value: '#d49b00' },
  { label: 'Green', value: '#30a46c' },
  { label: 'Teal', value: '#12a594' },
  { label: 'Blue', value: '#3e7bfa' },
  { label: 'Purple', value: '#8e4ec6' },
  { label: 'Pink', value: '#d6409f' },
] as const;

/** Highlight and table cell colours: translucent, so text stays readable in either theme. */
export const RICH_FILL_COLORS = [
  { label: 'Yellow', value: '#facc1566' },
  { label: 'Green', value: '#30a46c4d' },
  { label: 'Blue', value: '#3e7bfa40' },
  { label: 'Purple', value: '#8e4ec640' },
  { label: 'Pink', value: '#d6409f40' },
  { label: 'Red', value: '#e5484d40' },
  { label: 'Grey', value: '#8b8d9833' },
] as const;

/** Line spacing on offer, as in Word (1 is single spacing). */
export const RICH_LINE_SPACINGS = [1, 1.15, 1.5, 2] as const;

/** The page's JSON, or null when it isn't a rich document. Empty content is an empty page. */
export function parseRich(content: string): RichNode | null {
  if (content.trim() === '') return EMPTY_RICH_DOC;
  try {
    const value: unknown = JSON.parse(content);
    return isRichDoc(value) ? value : null;
  } catch {
    return null;
  }
}

function isRichDoc(value: unknown): value is RichNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as RichNode).type === 'doc' &&
    (!('content' in value) || Array.isArray((value as RichNode).content))
  );
}

/** Content a rich page may store: empty, or a document. */
export const isRichContent = (content: string): boolean => parseRich(content) !== null;

// Reading

const BLOCKS_WITH_TEXT = new Set(['paragraph', 'heading', 'codeBlock', 'blockMath']);

/** Plain text of a rich page, for snippets and search: one line per block. */
export function richToText(content: string | RichNode): string {
  const doc = typeof content === 'string' ? parseRich(content) : content;
  if (!doc) return '';
  const lines: string[] = [];
  let line = '';
  const end = () => {
    if (line.trim()) lines.push(line.trim());
    line = '';
  };
  const walk = (node: RichNode) => {
    switch (node.type) {
      case 'text':
        line += node.text ?? '';
        return;
      case 'hardBreak':
        end();
        return;
      case 'inlineMath':
        line += String(node.attrs?.latex ?? '');
        return;
      case 'blockMath':
        end();
        line = String(node.attrs?.latex ?? '');
        end();
        return;
      case 'image':
        end();
        line = [node.attrs?.alt, node.attrs?.caption].filter(Boolean).join(' ');
        end();
        return;
      case 'file':
        end();
        line = String(node.attrs?.name ?? '');
        end();
        return;
      case 'codeBlock':
        // A diagram's words, not its code.
        if (node.attrs?.language === DIAGRAM_LANGUAGE) {
          end();
          line = diagramText((node.content ?? []).map((c) => c.text ?? '').join(''));
          end();
          return;
        }
        break;
    }
    if (BLOCKS_WITH_TEXT.has(node.type)) end();
    for (const child of node.content ?? []) walk(child);
    if (BLOCKS_WITH_TEXT.has(node.type) || node.type === 'tableRow') end();
  };
  walk(doc);
  end();
  return lines.join('\n');
}

/** The page's headings, in order, for the outline. */
export function richHeadings(doc: RichNode): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  const walk = (node: RichNode) => {
    if (node.type === 'heading') {
      headings.push({ level: Number(node.attrs?.level ?? 1), text: plainText(node).trim() });
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return headings;
}

/** Ids of the files a rich page shows or links to. */
export function richAssetIds(doc: RichNode): string[] {
  const ids = new Set<string>();
  const take = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('asset:')) ids.add(value.slice(6));
  };
  const walk = (node: RichNode) => {
    take(node.attrs?.src);
    for (const mark of node.marks ?? []) if (mark.type === 'link') take(mark.attrs?.href);
    for (const child of node.content ?? []) walk(child);
  };
  walk(doc);
  return [...ids];
}

const plainText = (node: RichNode): string =>
  node.type === 'text'
    ? (node.text ?? '')
    : node.type === 'hardBreak'
      ? ' '
      : (node.content ?? []).map(plainText).join('');

// To Markdown

/** What Markdown can't express, reported before a page is converted (§9.4). */
export const RICH_LOSSES = {
  colour: 'Text colours, highlight colours and table cell colours',
  font: 'Fonts',
  fontSize: 'Font sizes',
  align: 'Text alignment',
  lineSpacing: 'Line spacing',
  indent: 'Indented paragraphs',
  mergedCells: 'Merged table cells (they are split again)',
  columnWidth: 'Table column widths',
  tableBlocks: 'Lists, images and other blocks inside table cells (their text stays)',
  headerRow: 'Tables without a header row (the first row becomes one)',
  imageLayout: 'Image sizes and alignment',
  diagramLayout: 'Diagram sizes, alignment and captions',
} as const;
export type RichLoss = keyof typeof RICH_LOSSES;

export interface MarkdownResult {
  markdown: string;
  /** What didn't survive, in the order of RICH_LOSSES. */
  lost: RichLoss[];
}

interface Context {
  lost: Set<RichLoss>;
  /** Inside a table cell: pipes are escaped and line breaks are `<br>`. */
  inTable: boolean;
}

/** A rich page as Markdown in Memora's dialect (§8.2), and what couldn't be kept. */
export function richToMarkdown(doc: RichNode): MarkdownResult {
  const ctx: Context = { lost: new Set(), inTable: false };
  const markdown = blocks(doc.content ?? [], ctx);
  const lost = (Object.keys(RICH_LOSSES) as RichLoss[]).filter((k) => ctx.lost.has(k));
  return { markdown, lost };
}

function blocks(nodes: RichNode[], ctx: Context): string {
  return nodes
    .map((node) => block(node, ctx))
    .filter((text) => text !== '')
    .join('\n\n');
}

function noteBlockAttrs(node: RichNode, ctx: Context) {
  const align = node.attrs?.textAlign;
  if (align && align !== 'left') ctx.lost.add('align');
  if (node.attrs?.lineSpacing) ctx.lost.add('lineSpacing');
  if (node.attrs?.indent) ctx.lost.add('indent');
}

/** Prefixes every line: the first with `first`, the rest with `rest`. */
function prefix(text: string, first: string, rest: string): string {
  return text
    .split('\n')
    .map((line, i) => {
      const lead = i === 0 ? first : rest;
      return line === '' ? lead.trimEnd() : lead + line;
    })
    .join('\n');
}

function block(node: RichNode, ctx: Context): string {
  switch (node.type) {
    case 'paragraph': {
      noteBlockAttrs(node, ctx);
      return escapeLineStarts(inline(node.content ?? [], ctx));
    }
    case 'heading': {
      noteBlockAttrs(node, ctx);
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      const text = inline(node.content ?? [], ctx).replace(/\n/g, ' ');
      return `${'#'.repeat(level)} ${text}`;
    }
    case 'blockquote':
      return prefix(blocks(node.content ?? [], ctx), '> ', '> ');
    case 'callout': {
      const kind = CALLOUT_KINDS.includes(node.attrs?.kind as CalloutKind)
        ? (node.attrs!.kind as string)
        : 'note';
      const body = blocks(node.content ?? [], ctx);
      return prefix(`[!${kind.toUpperCase()}]${body ? `\n${body}` : ''}`, '> ', '> ');
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return list(node, ctx);
    case 'codeBlock': {
      const code = plainText(node);
      if (node.attrs?.width || node.attrs?.align || node.attrs?.caption) {
        ctx.lost.add('diagramLayout');
      }
      const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
      return `${fence}${language}\n${code}\n${fence}`;
    }
    case 'blockMath':
      return `$$\n${String(node.attrs?.latex ?? '').trim()}\n$$`;
    case 'horizontalRule':
      return '---';
    case 'image':
      return image(node, ctx);
    case 'file': {
      const name = String(node.attrs?.name ?? 'File');
      return `[${escapeText(name, ctx)}](${url(String(node.attrs?.src ?? ''))})`;
    }
    case 'table':
      return table(node, ctx);
    default:
      // Anything else keeps its content.
      return node.content ? blocks(node.content, ctx) : escapeText(plainText(node), ctx);
  }
}

function image(node: RichNode, ctx: Context): string {
  const attrs = node.attrs ?? {};
  if (attrs.width || (attrs.align && attrs.align !== 'center')) ctx.lost.add('imageLayout');
  const alt = String(attrs.alt ?? '').replace(/[[\]\\]/g, '\\$&');
  const title = attrs.title ? ` "${String(attrs.title).replace(/"/g, '\\"')}"` : '';
  const markdown = `![${alt}](${url(String(attrs.src ?? ''))}${title})`;
  const caption = typeof attrs.caption === 'string' ? attrs.caption.trim() : '';
  return caption ? `${markdown}\n\n*${escapeText(caption, ctx)}*` : markdown;
}

function list(node: RichNode, ctx: Context): string {
  const start = Number(node.attrs?.start ?? 1);
  const items = node.content ?? [];
  // Loose (blank lines between items) when an item holds more than one paragraph.
  const loose = items.some(
    (item) => (item.content ?? []).filter((c) => c.type === 'paragraph').length > 1,
  );
  return items
    .map((item, i) => {
      const marker =
        node.type === 'orderedList'
          ? `${start + i}. `
          : node.type === 'taskList'
            ? `- [${item.attrs?.checked ? 'x' : ' '}] `
            : '- ';
      const indent = ' '.repeat(node.type === 'taskList' ? 2 : marker.length);
      const parts = (item.content ?? []).map((child, j) => ({
        text: block(child, ctx),
        // A list right after a paragraph hangs off it, without a blank line.
        joiner: j > 0 && !loose && child.type.endsWith('List') ? '\n' : '\n\n',
      }));
      const body = parts
        .filter((p) => p.text !== '')
        .map((p, j) => (j === 0 ? p.text : p.joiner + p.text))
        .join('');
      return prefix(body, marker, indent);
    })
    .join(loose ? '\n\n' : '\n');
}

function table(node: RichNode, ctx: Context): string {
  const rows = node.content ?? [];
  const grid: string[][] = [];
  const align: Align[] = [];
  const covered = new Set<string>();
  let headerRow = true;
  rows.forEach((row, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of row.content ?? []) {
      while (covered.has(`${r}:${c}`)) {
        grid[r]![c] = '';
        c++;
      }
      const attrs = cell.attrs ?? {};
      const colspan = Math.max(1, Number(attrs.colspan ?? 1));
      const rowspan = Math.max(1, Number(attrs.rowspan ?? 1));
      if (colspan > 1 || rowspan > 1) ctx.lost.add('mergedCells');
      if (attrs.backgroundColor) ctx.lost.add('colour');
      if (Array.isArray(attrs.colwidth) && attrs.colwidth.some(Boolean))
        ctx.lost.add('columnWidth');
      if (r === 0 && cell.type !== 'tableHeader') headerRow = false;
      const cellAlign = cellAlignment(cell);
      if (r === 0) align[c] = cellAlign;
      else if (cellAlign !== 'none' && cellAlign !== align[c]) ctx.lost.add('align');
      grid[r]![c] = cellText(cell, ctx);
      for (let dr = 0; dr < rowspan; dr++) {
        for (let dc = 0; dc < colspan; dc++) {
          if (dr || dc) covered.add(`${r + dr}:${c + dc}`);
        }
      }
      c += colspan;
    }
    while (covered.has(`${r}:${c}`)) {
      grid[r]![c] = '';
      c++;
    }
  });
  if (!headerRow) ctx.lost.add('headerRow');
  if (!grid.length) return '';
  const [header = [], ...body] = grid;
  return formatTable({ header, align, rows: body }).join('\n');
}

function cellAlignment(cell: RichNode): Align {
  const first = cell.content?.[0];
  const value = first?.attrs?.textAlign;
  return value === 'left' || value === 'center' || value === 'right' ? value : 'none';
}

function cellText(cell: RichNode, ctx: Context): string {
  const inner: Context = { lost: ctx.lost, inTable: true };
  const parts = (cell.content ?? []).map((child) => {
    if (child.type === 'paragraph' || child.type === 'heading') {
      if (child.attrs?.lineSpacing) ctx.lost.add('lineSpacing');
      if (child.attrs?.indent) ctx.lost.add('indent');
      return inline(child.content ?? [], inner);
    }
    ctx.lost.add('tableBlocks');
    return escapeCell(escapeText(richToText(child), inner));
  });
  return parts.filter(Boolean).join('<br>');
}

// Inline content

/** Markdown for marks, in nesting order (outermost first); code is handled on its own. */
const MARKS: Record<string, [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  underline: ['<u>', '</u>'],
  highlight: ['<mark>', '</mark>'],
  subscript: ['<sub>', '</sub>'],
  superscript: ['<sup>', '</sup>'],
};
const MARK_ORDER = Object.keys(MARKS);

function inline(nodes: RichNode[], ctx: Context): string {
  let out = '';
  // Runs of text sharing a link become one link.
  let i = 0;
  while (i < nodes.length) {
    const link = linkOf(nodes[i]!);
    let j = i + 1;
    while (j < nodes.length && sameLink(linkOf(nodes[j]!), link)) j++;
    const run = nodes.slice(i, j);
    if (!link) out += formatted(run, ctx);
    else {
      const href = String(link.attrs?.href ?? '');
      if (href.startsWith('wiki:')) out += wikiLink(href, run.map(plainText).join(''));
      else {
        const title = link.attrs?.title
          ? ` "${String(link.attrs.title).replace(/"/g, '\\"')}"`
          : '';
        out += `[${formatted(run, ctx)}](${url(href)}${title})`;
      }
    }
    i = j;
  }
  return out;
}

const linkOf = (node: RichNode) => node.marks?.find((m) => m.type === 'link');
const sameLink = (a: RichMark | undefined, b: RichMark | undefined) =>
  a === b || (!!a && !!b && a.attrs?.href === b.attrs?.href);

/** `[[Title]]`, `[[Title#Heading]]` or `[[Title|shown text]]`. */
function wikiLink(href: string, label: string): string {
  const [rawTitle = '', ...rest] = href.slice(5).split('#');
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const title = decode(rawTitle);
  const heading = rest.length ? decode(rest.join('#')) : '';
  const target = heading ? `${title}#${heading}` : title;
  const shown = label.trim();
  const plain = shown === target || (!title && shown === heading);
  return `[[${target}${plain || !shown ? '' : `|${shown.replace(/[[\]|]/g, '')}`}]]`;
}

/** A link target: in angle brackets when it has spaces or brackets. */
const url = (href: string) => (/[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, '')}>` : href);

function formatted(nodes: RichNode[], ctx: Context): string {
  let out = '';
  const open: string[] = [];
  let pendingSpace = '';
  const close = (count: number) => {
    for (let k = 0; k < count; k++) out += MARKS[open.pop()!]![1];
  };
  for (const node of nodes) {
    noteStyle(node, ctx);
    const marks = MARK_ORDER.filter((name) => node.marks?.some((m) => m.type === name));
    // Keep the open marks this node shares, in order; close the rest.
    let keep = 0;
    while (keep < open.length && marks.includes(open[keep]!)) keep++;
    let text: string;
    let lead = '';
    let trail = '';
    if (node.type === 'text') {
      const raw = node.text ?? '';
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw)!;
      lead = match[1]!;
      trail = match[3]!;
      const core = match[2]!;
      const code = node.marks?.some((m) => m.type === 'code');
      text = code ? inlineCode(core) : escapeText(core, ctx);
      if (!core) {
        // Only spaces: they go outside any formatting.
        text = '';
      }
    } else if (node.type === 'hardBreak') {
      text = ctx.inTable ? '<br>' : '\\\n';
    } else if (node.type === 'inlineMath') {
      text = `$${String(node.attrs?.latex ?? '')}$`;
    } else {
      text = escapeText(plainText(node), ctx);
    }
    if (keep < open.length) {
      close(open.length - keep);
    }
    out += pendingSpace + lead;
    if (text) {
      for (const name of marks) {
        if (!open.includes(name)) {
          out += MARKS[name]![0];
          open.push(name);
        }
      }
      out += text;
    }
    pendingSpace = trail;
  }
  close(open.length);
  return out + pendingSpace;
}

function noteStyle(node: RichNode, ctx: Context) {
  for (const mark of node.marks ?? []) {
    if (mark.type === 'textStyle') {
      if (mark.attrs?.color || mark.attrs?.backgroundColor) ctx.lost.add('colour');
      if (mark.attrs?.fontFamily) ctx.lost.add('font');
      if (mark.attrs?.fontSize) ctx.lost.add('fontSize');
    }
    if (mark.type === 'highlight' && mark.attrs?.color) ctx.lost.add('colour');
  }
}

function inlineCode(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Escapes what Markdown would otherwise read as formatting. */
function escapeText(text: string, ctx: Context): string {
  let out = text
    .replace(/[\\`*[\]~$]/g, '\\$&')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=[^\p{L}\p{N}]|$)/gu, (m) => m.replace('_', '\\_'))
    .replace(/<(?=[a-zA-Z/!?])/g, '\\<')
    .replace(/&(?=#?\w+;)/g, '&amp;');
  if (ctx.inTable) out = escapeCell(out);
  return out;
}

/** Escapes what would start a heading, quote, list or rule at the start of a line. */
function escapeLineStarts(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^[ \t]+/, '')
        .replace(/^(#{1,6}(?:\s|$)|>|[-+](?=\s|$)|=+\s*$|-+\s*$)/, '\\$1')
        .replace(/^(\d+)([.)])(?=\s|$)/, '$1\\$2'),
    )
    .join('\n');
}
