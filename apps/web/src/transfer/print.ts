import pagedUrl from 'pagedjs-polyfill?url';

/*
 * The printable document (§9.10): a print stylesheet with page numbers, each page of a
 * section starting on a new sheet. In the browser Paged.js lays it out in pages for the
 * preview; Gotenberg's Chromium reads the same stylesheet.
 */

/** Paged.js, loaded into the preview frame. */
export const pagedScript = pagedUrl;

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Letter in North America, A4 everywhere else. */
function paperSize(): 'letter' | 'A4' {
  const region = /-(US|CA|MX)\b/i.exec(navigator.language)?.[1];
  return region ? 'letter' : 'A4';
}

const STYLE = (size: string) => `
@page {
  size: ${size};
  margin: 20mm 18mm 22mm;
  @bottom-center { content: counter(page) " / " counter(pages); font: 9pt system-ui, sans-serif; color: #6b7280; }
}
html { background: #fff; }
body { font: 11pt/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f2328; margin: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; break-after: avoid; margin: 1.2em 0 0.5em; }
h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
.document-title { margin-top: 0; }
.page + .page { break-before: page; }
p, li { orphans: 2; widows: 2; }
img { max-width: 100%; height: auto; }
figure { margin: 1em 0; break-inside: avoid; } figcaption { font-size: 9pt; color: #59636e; }
figure.diagram { display: flex; flex-direction: column; align-items: center; } figure.diagram[data-align="left"] { align-items: flex-start; } figure.diagram[data-align="right"] { align-items: flex-end; }
.diagram-svg { max-width: 100%; } .diagram-svg svg { display: block; width: 100%; max-width: 100%; height: auto; }
pre, table, blockquote, .callout, .math { break-inside: avoid; }
pre { background: #f6f8fa; padding: 0.7em 0.9em; border-radius: 4px; white-space: pre-wrap; font-size: 9.5pt; }
code { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; }
table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid #d0d7de; padding: 0.3em 0.6em; text-align: left; vertical-align: top; }
th { background: #f6f8fa; }
blockquote { border-left: 3px solid #d0d7de; margin-left: 0; padding-left: 1em; color: #59636e; }
.callout { border-left: 3px solid #0969da; background: #f6f8fa; padding: 0.3em 1em; margin: 1em 0; }
.task-list { list-style: none; padding-left: 0.5em; }
a { color: #0969da; } .wiki-link { color: #0969da; text-decoration: underline dotted; }
hr { border: 0; border-top: 1px solid #d0d7de; }
/* The preview: sheets on a grey desk. */
@media screen {
  body { background: #e9ebee; }
  .pagedjs_pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px 0; }
  .pagedjs_page { background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.18); }
}
`;

/**
 * A complete document to print. With `script`, Paged.js lays it out (the preview); without,
 * it is sent as it is (Gotenberg).
 */
export function printHtml(title: string, body: string, script: string | null): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(title)}</title>
<style>${STYLE(paperSize())}</style>
${script ? `<script src="${escape(script)}"></script>` : ''}
</head>
<body>
<h1 class="document-title">${escape(title)}</h1>
${body}
</body>
</html>
`;
}
