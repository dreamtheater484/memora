import { ASSET_SCHEME } from './assets';
import { RICH_INDENT_EM, RICH_MAX_INDENT, type RichMark, type RichNode } from './rich';

/*
 * A rich page as plain HTML (§8.4), without a browser: the readable copy in `.memora`
 * archives. Only what the editor makes is written, and every text and attribute is escaped.
 */

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Addresses a link or image may keep; anything else is dropped. */
const SAFE_URL = /^(https?:|mailto:|tel:|#)/i;

export interface RichHtmlOptions {
  /** Where a page's file (`asset:<id>`) is found from the HTML file. */
  asset?: (id: string) => string | null;
}

function url(value: unknown, options: RichHtmlOptions): string | null {
  if (typeof value !== 'string') return null;
  if (value.startsWith(ASSET_SCHEME))
    return options.asset?.(value.slice(ASSET_SCHEME.length)) ?? null;
  return SAFE_URL.test(value) ? value : null;
}

function styleOf(attrs: Record<string, unknown> | undefined): string {
  const styles: string[] = [];
  const align = attrs?.textAlign;
  if (
    typeof align === 'string' &&
    /^(left|center|right|justify)$/.test(align) &&
    align !== 'left'
  ) {
    styles.push(`text-align: ${align}`);
  }
  const indent = Number(attrs?.indent);
  if (Number.isInteger(indent) && indent > 0 && indent <= RICH_MAX_INDENT) {
    styles.push(`margin-left: ${indent * RICH_INDENT_EM}em`);
  }
  return styles.length ? ` style="${styles.join('; ')}"` : '';
}

function marked(text: string, marks: RichMark[] | undefined, options: RichHtmlOptions): string {
  let html = escape(text);
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        html = `<strong>${html}</strong>`;
        break;
      case 'italic':
        html = `<em>${html}</em>`;
        break;
      case 'strike':
        html = `<s>${html}</s>`;
        break;
      case 'underline':
        html = `<u>${html}</u>`;
        break;
      case 'code':
        html = `<code>${html}</code>`;
        break;
      case 'subscript':
        html = `<sub>${html}</sub>`;
        break;
      case 'superscript':
        html = `<sup>${html}</sup>`;
        break;
      case 'highlight':
        html = `<mark>${html}</mark>`;
        break;
      case 'link': {
        const href = mark.attrs?.href;
        if (typeof href === 'string' && href.startsWith('wiki:')) {
          html = `<a class="wiki-link" data-page="${escape(decodeURIComponent(href.slice(5)))}">${html}</a>`;
        } else {
          const target = url(href, options);
          if (target) html = `<a href="${escape(target)}">${html}</a>`;
        }
        break;
      }
      case 'textStyle': {
        const color = mark.attrs?.color;
        if (typeof color === 'string' && /^#[0-9a-f]{3,8}$/i.test(color)) {
          html = `<span style="color: ${color}">${html}</span>`;
        }
        break;
      }
    }
  }
  return html;
}

function children(node: RichNode, options: RichHtmlOptions): string {
  return (node.content ?? []).map((child) => render(child, options)).join('');
}

function cellAttrs(attrs: Record<string, unknown> | undefined): string {
  const out: string[] = [];
  for (const key of ['colspan', 'rowspan'] as const) {
    const value = Number(attrs?.[key] ?? 1);
    if (Number.isInteger(value) && value > 1) out.push(` ${key}="${value}"`);
  }
  return out.join('');
}

function render(node: RichNode, options: RichHtmlOptions): string {
  const attrs = node.attrs;
  switch (node.type) {
    case 'text':
      return marked(node.text ?? '', node.marks, options);
    case 'doc':
      return children(node, options);
    case 'paragraph':
      return `<p${styleOf(attrs)}>${children(node, options)}</p>\n`;
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(attrs?.level ?? 1)));
      return `<h${level}${styleOf(attrs)}>${children(node, options)}</h${level}>\n`;
    }
    case 'bulletList':
      return `<ul>\n${children(node, options)}</ul>\n`;
    case 'orderedList': {
      const start = Number(attrs?.start ?? 1);
      return `<ol${start !== 1 ? ` start="${start}"` : ''}>\n${children(node, options)}</ol>\n`;
    }
    case 'listItem':
      return `<li>${children(node, options)}</li>\n`;
    case 'taskList':
      return `<ul class="task-list">\n${children(node, options)}</ul>\n`;
    case 'taskItem':
      return `<li class="task-list-item"><input type="checkbox" disabled${attrs?.checked ? ' checked' : ''}> ${children(node, options)}</li>\n`;
    case 'blockquote':
      return `<blockquote>\n${children(node, options)}</blockquote>\n`;
    case 'callout': {
      const kind = typeof attrs?.kind === 'string' ? attrs.kind : 'note';
      return `<div class="callout callout-${escape(kind)}">\n${children(node, options)}</div>\n`;
    }
    case 'codeBlock': {
      const language = typeof attrs?.language === 'string' ? attrs.language : '';
      const text = (node.content ?? []).map((c) => c.text ?? '').join('');
      return `<pre><code${language ? ` class="language-${escape(language)}"` : ''}>${escape(text)}</code></pre>\n`;
    }
    case 'horizontalRule':
      return '<hr>\n';
    case 'hardBreak':
      return '<br>';
    case 'image': {
      const src = url(attrs?.src, options);
      if (!src) return '';
      const alt = typeof attrs?.alt === 'string' ? attrs.alt : '';
      const width = Number(attrs?.width);
      const caption = typeof attrs?.caption === 'string' ? attrs.caption : '';
      const img = `<img src="${escape(src)}" alt="${escape(alt)}"${width > 0 ? ` width="${Math.round(width)}"` : ''}>`;
      return caption
        ? `<figure>${img}<figcaption>${escape(caption)}</figcaption></figure>\n`
        : `<p>${img}</p>\n`;
    }
    case 'file': {
      const href = url(attrs?.src, options);
      const name = escape(typeof attrs?.name === 'string' ? attrs.name : 'File');
      return href
        ? `<p class="file"><a href="${escape(href)}">${name}</a></p>\n`
        : `<p class="file">${name}</p>\n`;
    }
    case 'blockMath':
      return `<div class="math">${escape(String(attrs?.latex ?? ''))}</div>\n`;
    case 'inlineMath':
      return `<span class="math">${escape(String(attrs?.latex ?? ''))}</span>`;
    case 'table':
      return `<table>\n${children(node, options)}</table>\n`;
    case 'tableRow':
      return `<tr>${children(node, options)}</tr>\n`;
    case 'tableHeader':
      return `<th${cellAttrs(attrs)}>${children(node, options)}</th>`;
    case 'tableCell':
      return `<td${cellAttrs(attrs)}>${children(node, options)}</td>`;
    default:
      return children(node, options);
  }
}

/** The document's body as HTML. */
export function richToHtml(doc: RichNode, options: RichHtmlOptions = {}): string {
  return render(doc, options);
}

/** A whole HTML file, readable in any browser. */
export function htmlDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
body { font: 16px/1.6 system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; color: #1f2328; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 0.3em 0.6em; }
pre { background: #f6f8fa; padding: 0.8em; overflow: auto; } code { font-family: ui-monospace, monospace; }
blockquote { border-left: 4px solid #d0d7de; margin-left: 0; padding-left: 1em; color: #59636e; }
.callout { border-left: 4px solid #0969da; background: #f6f8fa; padding: 0.4em 1em; margin: 1em 0; }
.task-list { list-style: none; padding-left: 1em; }
</style>
</head>
<body>
<h1>${escape(title)}</h1>
${body}</body>
</html>
`;
}
