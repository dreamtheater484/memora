import type { PageType } from './notes';
import { parseRich, type RichNode } from './rich';

/*
 * Links between pages (§9.9): `[[Title]]`, `[[Title|shown text]]` and `[[Title#Heading]]` in
 * Markdown, links to `wiki:Title` in rich pages. A link names its page by title; renaming a
 * page rewrites the links to it, so they keep working.
 */

const WIKI = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;
const WIKI_SCHEME = 'wiki:';

/** The key titles are compared by: case and surrounding spaces don't matter. */
export const titleKey = (title: string): string => title.trim().toLowerCase();

/**
 * Runs `each` over the Markdown outside code (fenced blocks and inline code), answering the
 * text with each part replaced by what `each` returns.
 */
function outsideCode(markdown: string, each: (text: string) => string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let prose = '';
  const flush = () => {
    // Inline code spans stay as they are.
    out.push(
      prose
        .split(/(`+[^`]*?`+)/g)
        .map((part, i) => (i % 2 ? part : each(part)))
        .join(''),
    );
    prose = '';
  };
  for (const line of markdown.split(/(?<=\n)/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    } else if (marker) {
      flush();
      fence = marker;
      out.push(line);
    } else prose += line;
  }
  flush();
  return out.join('');
}

function splitTarget(inner: string): { title: string; heading: string | null } {
  const at = inner.indexOf('#');
  if (at < 0) return { title: inner.trim(), heading: null };
  return { title: inner.slice(0, at).trim(), heading: inner.slice(at + 1) };
}

function richHref(href: unknown): { title: string; heading: string | null } | null {
  if (typeof href !== 'string' || !href.startsWith(WIKI_SCHEME)) return null;
  const [title = '', heading] = href.slice(WIKI_SCHEME.length).split('#');
  try {
    return {
      title: decodeURIComponent(title).trim(),
      heading: heading === undefined ? null : decodeURIComponent(heading),
    };
  } catch {
    return null;
  }
}

function walk(node: RichNode, each: (node: RichNode) => void) {
  each(node);
  for (const child of node.content ?? []) walk(child, each);
}

/** The titles a page links to, each once (by `titleKey`), in order. */
export function linkedTitles(type: PageType, content: string): string[] {
  const titles = new Map<string, string>();
  const add = (title: string) => {
    if (title && !titles.has(titleKey(title))) titles.set(titleKey(title), title);
  };
  if (type === 'markdown') {
    outsideCode(content, (text) => {
      for (const match of text.matchAll(WIKI)) add(splitTarget(match[1]!).title);
      return text;
    });
  } else {
    const doc = parseRich(content);
    if (doc) {
      walk(doc, (node) => {
        for (const mark of node.marks ?? []) {
          if (mark.type === 'link') {
            const target = richHref(mark.attrs?.href);
            if (target) add(target.title);
          }
        }
      });
    }
  }
  return [...titles.values()];
}

/**
 * The page's content with its links to `from` pointing at `to` instead (`[[From]]` becomes
 * `[[To]]`, keeping headings and shown text), or null when it has none.
 */
export function renameLinks(
  type: PageType,
  content: string,
  from: string,
  to: string,
): string | null {
  const key = titleKey(from);
  let changed = false;
  if (type === 'markdown') {
    const next = outsideCode(content, (text) =>
      text.replace(WIKI, (whole, inner: string, shown?: string) => {
        const { title, heading } = splitTarget(inner);
        if (titleKey(title) !== key) return whole;
        changed = true;
        return `[[${to}${heading === null ? '' : `#${heading}`}${shown === undefined ? '' : `|${shown}`}]]`;
      }),
    );
    return changed ? next : null;
  }
  const doc = parseRich(content);
  if (!doc) return null;
  walk(doc, (node) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== 'link') continue;
      const target = richHref(mark.attrs?.href);
      if (!target || titleKey(target.title) !== key) continue;
      changed = true;
      const heading = target.heading === null ? '' : `#${encodeURIComponent(target.heading)}`;
      mark.attrs = { ...mark.attrs, href: `${WIKI_SCHEME}${encodeURIComponent(to)}${heading}` };
      // A link that shows the page's title shows the new one.
      if (node.type === 'text' && node.text?.trim() === from.trim()) node.text = to;
    }
  });
  return changed ? JSON.stringify(doc) : null;
}
