import { RICH_FONTS, RICH_FONT_SIZES } from '@memora/shared';
import DOMPurify from 'dompurify';

/*
 * Pasting into a rich page from Word, Google Docs and web pages (§9.4, §11): the HTML is
 * sanitised with DOMPurify, then its formatting is kept but cleaned. Only styles the rich page
 * supports survive; fonts map onto the curated set (others go), sizes onto the curated sizes
 * (body-sized text keeps the page's size), black text and white backgrounds go (they would
 * break the dark theme), and Word's paragraph "lists" become real lists.
 */

/** Styles kept, by property; each returns the value to keep, or null to drop it. */
const STYLES: Record<string, (value: string) => string | null> = {
  color: (v) => (isDefaultColour(v, 'text') ? null : v),
  'background-color': (v) => (isDefaultColour(v, 'background') ? null : v),
  'font-family': fontFamily,
  'font-size': fontSize,
  'font-weight': (v) => v,
  'font-style': (v) => (v === 'italic' ? v : null),
  'text-decoration': decoration,
  'text-decoration-line': decoration,
  'vertical-align': (v) => (v === 'super' || v === 'sub' ? v : null),
  'text-align': (v) => (['center', 'right', 'justify'].includes(v) ? v : null),
};

function decoration(value: string): string | null {
  const kept = value.split(/\s+/).filter((v) => v === 'underline' || v === 'line-through');
  return kept.length ? kept.join(' ') : null;
}

/** Colours that are only the page's own defaults: black text, white or clear backgrounds. */
function isDefaultColour(value: string, kind: 'text' | 'background'): boolean {
  const v = value.replace(/\s+/g, '').toLowerCase();
  if (['inherit', 'initial', 'currentcolor', 'auto', 'windowtext', 'transparent'].includes(v))
    return true;
  const rgb = parseColour(v);
  if (!rgb) return kind === 'background' ? v === 'window' : false;
  if (rgb.a === 0) return true;
  const light = (rgb.r + rgb.g + rgb.b) / 3;
  return kind === 'text' ? light < 40 : light > 245;
}

function parseColour(value: string): { r: number; g: number; b: number; a: number } | null {
  const named: Record<string, string> = { black: '#000000', white: '#ffffff' };
  const v = named[value] ?? value;
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) {
    const [r, g, b] = [...m[1]!].map((c) => parseInt(c + c, 16));
    return { r: r!, g: g!, b: b!, a: 1 };
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) {
    const n = parseInt(m[1]!, 16);
    return {
      r: n >> 16,
      g: (n >> 8) & 255,
      b: n & 255,
      a: m[2] ? parseInt(m[2], 16) / 255 : 1,
    };
  }
  m = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/.exec(v);
  if (m) return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

/** A pasted font, mapped onto the curated set by its kind; others use the page's font. */
function fontFamily(value: string): string | null {
  const v = value.toLowerCase();
  if (/mono|courier|consolas|menlo|monaco/.test(v)) return RICH_FONTS[1].value;
  if (/bricolage/.test(v)) return RICH_FONTS[2].value;
  if (/(^|[^-])\bserif\b|georgia|times|cambria|garamond|palatino|book antiqua/.test(v)) {
    return RICH_FONTS[0].value;
  }
  return null;
}

const PX_PER_PT = 96 / 72;

/** A pasted size in points, on the curated scale; body-sized text keeps the page's size. */
function fontSize(value: string): string | null {
  const m = /^([\d.]+)(pt|px|em|rem)$/.exec(value.trim().toLowerCase());
  if (!m) return null;
  const n = Number(m[1]);
  const pt = m[2] === 'pt' ? n : m[2] === 'px' ? n / PX_PER_PT : /* em, rem */ n * 12;
  if (!Number.isFinite(pt) || (pt >= 10.5 && pt <= 12.5)) return null;
  const nearest = RICH_FONT_SIZES.reduce((best, size) =>
    Math.abs(size - pt) < Math.abs(best - pt) ? size : best,
  );
  return nearest === 12 ? null : `${nearest}pt`;
}

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'DIV']);

/** Formatting written as styles, as the tags the rich schema reads best. */
function semanticTags(styles: Map<string, string>): string[] {
  const tags: string[] = [];
  const weight = styles.get('font-weight');
  if (weight && /^(bold|bolder|[6-9]00)$/.test(weight)) tags.push('strong');
  if (styles.get('font-style') === 'italic') tags.push('em');
  const decoration = `${styles.get('text-decoration') ?? ''} ${styles.get('text-decoration-line') ?? ''}`;
  if (decoration.includes('underline')) tags.push('u');
  if (decoration.includes('line-through')) tags.push('s');
  const align = styles.get('vertical-align');
  if (align === 'super') tags.push('sup');
  if (align === 'sub') tags.push('sub');
  for (const name of [
    'font-weight',
    'font-style',
    'text-decoration',
    'text-decoration-line',
    'vertical-align',
  ]) {
    styles.delete(name);
  }
  return tags;
}

function cleanStyle(element: HTMLElement) {
  const style = element.getAttribute('style');
  if (style === null) return;
  const styles = new Map<string, string>();
  for (const part of style.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    const raw = part
      .slice(at + 1)
      .replace(/!important/i, '')
      .trim();
    // `background` shorthand from Google Docs and web pages: only its colour matters.
    const property = name === 'background' ? 'background-color' : name;
    const value = STYLES[property]?.(raw.toLowerCase());
    if (value) styles.set(property, value);
  }
  const block = BLOCKS.has(element.tagName);
  const tags = semanticTags(styles);
  if (block && element.tagName !== 'TD' && element.tagName !== 'TH')
    styles.delete('background-color');
  else styles.delete('text-align');
  if (!block && tags.length) {
    // <span style="font-weight:700"> becomes <span><strong>…</strong></span>.
    let inner: HTMLElement = element;
    for (const tag of tags) {
      const wrapper = element.ownerDocument.createElement(tag);
      wrapper.append(...inner.childNodes);
      inner.append(wrapper);
      inner = wrapper;
    }
  }
  if (styles.size) {
    element.setAttribute(
      'style',
      [...styles].map(([name, value]) => `${name}: ${value}`).join('; '),
    );
  } else element.removeAttribute('style');
}

const unwrap = (element: Element) => element.replaceWith(...element.childNodes);

/** Word writes lists as paragraphs with `mso-list` styles and a typed-out bullet. */
function wordLists(root: HTMLElement) {
  let stack: { level: number; list: HTMLElement }[] = [];
  for (const p of [...root.querySelectorAll<HTMLElement>('p[style*="mso-list"]')]) {
    const level = Number(/level(\d+)/.exec(p.getAttribute('style') ?? '')?.[1] ?? 1);
    const marker = p.querySelector('span[style*="mso-list"]');
    const markerText = (marker?.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    marker?.remove();
    const ordered = /^\(?[0-9a-z]{1,4}[.)]$/i.test(markerText);
    // A list goes on while its paragraphs follow each other.
    if (!stack.length || p.previousElementSibling !== stack[0]!.list) stack = [];
    while (stack.length && stack.at(-1)!.level > level) stack.pop();
    if (!stack.length || stack.at(-1)!.level < level) {
      const list = root.ownerDocument.createElement(ordered ? 'ol' : 'ul');
      const parentItem = stack.at(-1)?.list.lastElementChild;
      if (parentItem) parentItem.append(list);
      else p.before(list);
      stack.push({ level, list });
    }
    const item = root.ownerDocument.createElement('li');
    item.append(...p.childNodes);
    stack.at(-1)!.list.append(item);
    p.remove();
  }
}

/** Classes the rich schema reads: code languages and callouts. */
const KEPT_CLASS = /^(language-[\w+#.-]+|markdown-alert(-\w+)?)$/;

/** Links and images may also point at pages and files (`wiki:`, `asset:`). */
const ALLOWED_URI = /^(?:(?:https?|mailto|tel|asset|wiki):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

/** Cleans pasted HTML for the rich schema to read. */
export function cleanPastedHtml(html: string): string {
  const root = DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'script', 'meta', 'link', 'title', 'noscript', 'iframe', 'form'],
    FORBID_ATTR: ['id', 'lang', 'dir'],
    ALLOW_DATA_ATTR: true,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    RETURN_DOM: true,
  }) as HTMLElement;
  // Google Docs wraps everything in a bold element that isn't bold.
  for (const b of root.querySelectorAll(
    'b[style*="font-weight:normal"], b[style*="font-weight: normal"]',
  )) {
    unwrap(b);
  }
  wordLists(root);
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) cleanStyle(element);
  for (const element of root.querySelectorAll('[class]')) {
    const kept = [...element.classList].filter((c) => KEPT_CLASS.test(c));
    if (kept.length) element.setAttribute('class', kept.join(' '));
    else element.removeAttribute('class');
  }
  // Spans without a style, and old `<font>` tags, carry nothing.
  for (const element of root.querySelectorAll('span:not([style]):not([data-type]), font')) {
    unwrap(element);
  }
  // Empty paragraphs (Word's spacing) go.
  for (const p of root.querySelectorAll('p')) {
    if (!p.textContent?.replace(/\u00a0/g, '').trim() && !p.querySelector('img, br')) p.remove();
  }
  return root.innerHTML;
}
