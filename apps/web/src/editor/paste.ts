import { formatTable, isInlineImage, tableFromTsv } from '@memora/shared';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/*
 * Paste and drop (§9.3): images and other files are kept as the page's files (offline too:
 * they wait on the device like typing does) and linked where they land; cells copied from a
 * spreadsheet become a table; HTML from a web page or a word processor becomes clean Markdown.
 * A URL pasted over selected text becomes a link (CodeMirror's Markdown support does that).
 */

export interface FileHost {
  /** Keeps a file until the server has it; answers the id the text refers to. */
  addFile(file: Blob, name: string): Promise<string>;
}

const extensionOf = (type: string) =>
  ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' })[type] ??
  'bin';

/** Markdown for a kept file: an image, or a link to download it. */
function markdownFor(id: string, file: File): string {
  const clipboard = /^image\.\w+$/.test(file.name);
  const name = file.name || `file.${extensionOf(file.type)}`;
  if (isInlineImage(file.type)) {
    const alt = clipboard ? 'Pasted image' : name.replace(/\.[^.]+$/, '');
    return `![${alt.replace(/[[\]]/g, '')}](asset:${id})`;
  }
  return `[${name.replace(/[[\]]/g, '')}](asset:${id})`;
}

/** Keeps the files and inserts their Markdown at `pos`. */
export async function insertFiles(
  view: EditorView,
  files: File[],
  host: FileHost,
  pos = view.state.selection.main.head,
): Promise<void> {
  const parts: string[] = [];
  for (const file of files) {
    const name = file.name || `pasted.${extensionOf(file.type)}`;
    const id = await host.addFile(file, name);
    parts.push(markdownFor(id, file));
  }
  if (!parts.length) return;
  const images = files.every((f) => isInlineImage(f.type));
  const insert = parts.join(images && parts.length > 1 ? '\n\n' : '\n');
  const at = Math.min(pos, view.state.doc.length);
  view.dispatch({
    changes: {
      from: at,
      to: at === view.state.selection.main.head ? view.state.selection.main.to : at,
      insert,
    },
    selection: EditorSelection.cursor(at + insert.length),
    userEvent: 'input.paste',
    scrollIntoView: true,
  });
}

/** Tags that make HTML worth converting; anything else is pasted as its plain text. */
const STRUCTURE =
  /<(a|img|strong|b|em|i|u|s|del|h[1-6]|ul|ol|li|table|blockquote|pre|code|hr)[\s>]/i;

async function htmlToMarkdown(html: string): Promise<string> {
  const [{ default: TurndownService }, gfm] = await Promise.all([
    import('turndown'),
    import('@joplin/turndown-plugin-gfm'),
  ]);
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
  });
  service.use(gfm.gfm);
  service.remove(['script', 'style', 'meta', 'link', 'title', 'head', 'noscript']);
  // Word and Google Docs wrap everything in spans and empty paragraphs.
  return service
    .turndown(html)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pasteText(view: EditorView, text: string) {
  view.dispatch(view.state.replaceSelection(text), {
    userEvent: 'input.paste',
    scrollIntoView: true,
  });
}

export function pasteAndDrop(host: FileHost) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData;
      if (!data) return false;
      const files = [...data.files];
      if (files.length) {
        event.preventDefault();
        void insertFiles(view, files, host);
        return true;
      }
      const plain = data.getData('text/plain');
      const table = plain ? tableFromTsv(plain) : null;
      if (table) {
        event.preventDefault();
        pasteText(view, formatTable(table).join('\n'));
        return true;
      }
      const html = data.getData('text/html');
      if (
        html &&
        STRUCTURE.test(html) &&
        !view.state.selection.ranges.some((r) => !r.empty && /^https?:\/\//.test(plain))
      ) {
        event.preventDefault();
        void htmlToMarkdown(html).then(
          (markdown) => pasteText(view, markdown || plain),
          () => pasteText(view, plain),
        );
        return true;
      }
      return false;
    },
    drop(event, view) {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (!files.length) return false;
      event.preventDefault();
      const pos =
        view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
      void insertFiles(view, files, host, pos);
      return true;
    },
  });
}
