import type { Element, Root as HastRoot } from 'hast';
import type { Blockquote, Link, Paragraph, PhrasingContent, Root as MdastRoot, Text } from 'mdast';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

/*
 * Markdown → HTML tree (§8.2, §9.3), the same for the preview and, later, exports: CommonMark
 * and GFM (tables, task lists, strikethrough, autolinks, footnotes), GitHub alerts, maths,
 * Mermaid and wiki links. Raw HTML is allowed and then sanitised, like GitHub does. Block
 * elements carry the source line they start on (`data-line`), for scroll sync, the outline and
 * clicking task boxes. Pure: runs in a worker, or directly where there is none (tests).
 */

export const ALERT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

const ALERT_TITLES: Record<AlertType, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

/** `> [!NOTE]` blockquotes become alert boxes, titled by their kind. */
function remarkAlerts() {
  return (tree: MdastRoot) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const first = node.children[0];
      if (first?.type !== 'paragraph') return;
      const head = first.children[0];
      if (head?.type !== 'text') return;
      const match = /^\[!(\w+)\][ \t]*(?:\r?\n|$)/.exec(head.value);
      const type = match?.[1]?.toLowerCase() as AlertType | undefined;
      if (!match || !type || !ALERT_TYPES.includes(type)) return;
      head.value = head.value.slice(match[0].length);
      if (!head.value) first.children.shift();
      if (!first.children.length) node.children.shift();
      const title: Paragraph = {
        type: 'paragraph',
        children: [{ type: 'text', value: ALERT_TITLES[type] }],
        data: { hProperties: { className: ['markdown-alert-title'] } },
      };
      node.children.unshift(title);
      node.data = {
        hName: 'div',
        hProperties: { className: ['markdown-alert', `markdown-alert-${type}`] },
      };
    });
  };
}

/** What a wiki link points at: `[[Title]]`, `[[Title|shown text]]`, `[[Title#Heading]]`. */
export interface WikiTarget {
  title: string;
  heading: string | null;
  label: string;
}

const WIKI = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;

export function parseWiki(inner: string, shown?: string): WikiTarget {
  const [title = '', ...rest] = inner.split('#');
  const heading = rest.join('#').trim() || null;
  return {
    title: title.trim(),
    heading,
    label: shown?.trim() || (heading && !title.trim() ? heading : inner.trim()),
  };
}

/** Wiki links become links to `wiki:`; the preview finds the page by its title. */
function remarkWikiLinks() {
  return (tree: MdastRoot) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === 'link') return;
      if (!node.value.includes('[[')) return;
      const parts: PhrasingContent[] = [];
      let last = 0;
      for (const match of node.value.matchAll(WIKI)) {
        const target = parseWiki(match[1]!, match[2]);
        if (!target.title && !target.heading) continue;
        if (match.index > last)
          parts.push({ type: 'text', value: node.value.slice(last, match.index) });
        const link: Link = {
          type: 'link',
          url: `wiki:${encodeURIComponent(target.title)}${target.heading ? `#${encodeURIComponent(target.heading)}` : ''}`,
          children: [{ type: 'text', value: target.label }],
          data: { hProperties: { className: ['wiki-link'] } },
        };
        parts.push(link);
        last = match.index + match[0].length;
      }
      if (!parts.length) return;
      if (last < node.value.length) parts.push({ type: 'text', value: node.value.slice(last) });
      parent.children.splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}

const LINED = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'pre',
  'blockquote',
  'table',
  'tr',
  'hr',
  'div',
  'dl',
  'details',
  'img',
]);

/** Block elements remember the source line they start on. */
function rehypeLines() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      const line = node.position?.start.line;
      if (line && LINED.has(node.tagName)) node.properties.dataLine = line;
    });
  };
}

/** Task boxes take their list item's line, so a click changes the right line. */
function rehypeTaskLines() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node: Element) => {
      if (node.tagName !== 'li' || !node.properties.dataLine) return;
      visit(node, 'element', (child: Element) => {
        if (child.tagName === 'li' && child !== node) return SKIP;
        if (child.tagName === 'input' && child.properties.type === 'checkbox') {
          child.properties.dataLine = node.properties.dataLine;
        }
      });
    });
  };
}

type Attributes = NonNullable<typeof defaultSchema.attributes>;

/** A tag's allowed attributes, with its classes replaced by `classes`. */
function withClasses(tag: string, ...classes: (string | RegExp)[]): Attributes[string] {
  const others = (defaultSchema.attributes?.[tag] ?? []).filter(
    (a) => !(Array.isArray(a) && a[0] === 'className') && a !== 'className',
  );
  return [...others, ['className', ...classes]];
}

/** GitHub's list of what may stay, plus what Memora's own features need. */
export const sanitizeSchema = {
  ...defaultSchema,
  // Underline and highlight, which rich pages keep when converted to Markdown.
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'mark'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataLine'],
    code: withClasses('code', /^language-[\w+#.-]+$/, 'math-inline', 'math-display'),
    div: withClasses('div', 'markdown-alert', /^markdown-alert-[a-z]+$/),
    p: withClasses('p', 'markdown-alert-title'),
    a: withClasses('a', 'wiki-link', 'data-footnote-backref'),
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'asset', 'wiki'],
    src: [...(defaultSchema.protocols?.src ?? []), 'asset'],
  },
};

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml', 'toml'])
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkAlerts)
  .use(remarkWikiLinks)
  // The sanitiser prefixes ids (`user-content-`), so footnotes aren't prefixed twice.
  .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
  .use(rehypeRaw)
  .use(rehypeLines)
  .use(rehypeTaskLines)
  .use(rehypeSanitize, sanitizeSchema);

/** The page's Markdown as a sanitised HTML tree. */
export function toHast(markdown: string): HastRoot {
  const mdast = processor.parse(markdown);
  return processor.runSync(mdast) as HastRoot;
}
