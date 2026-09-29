import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import { fuzzyScore } from '../lib/fuzzy';
import {
  insertCallout,
  insertCodeBlock,
  insertDate,
  insertMath,
  insertMermaid,
  insertRule,
  setHeading,
  toggleList,
  toggleQuote,
} from './commands';
import { insertTable } from './tables';

/*
 * Slash commands (`/table`, `/code`, …) and `[[` page suggestions (§9.3), both through
 * CodeMirror's autocomplete, so they work with the keyboard and on touch alike.
 */

export interface CompletionHost {
  /** Page titles to link to. */
  pages(): { id: string; title: string }[];
  /** Opens the file picker and inserts what is chosen. */
  pickFile(view: EditorView, images: boolean): void;
}

interface SlashCommand {
  name: string;
  detail: string;
  keywords?: string;
  run(view: EditorView): void;
}

function slashCommands(host: CompletionHost): SlashCommand[] {
  return [
    { name: 'table', detail: 'A 3 × 2 table', run: (v) => insertTable(v, 3, 2) },
    { name: 'code', detail: 'Code block', run: (v) => void insertCodeBlock()(v) },
    {
      name: 'mermaid',
      detail: 'Diagram',
      keywords: 'chart flowchart',
      run: (v) => void insertMermaid(v),
    },
    {
      name: 'math',
      detail: 'Formula',
      keywords: 'latex katex equation',
      run: (v) => void insertMath(v),
    },
    {
      name: 'callout',
      detail: 'Note box',
      keywords: 'alert note',
      run: (v) => void insertCallout('NOTE')(v),
    },
    {
      name: 'tip',
      detail: 'Tip box',
      keywords: 'alert callout',
      run: (v) => void insertCallout('TIP')(v),
    },
    {
      name: 'warning',
      detail: 'Warning box',
      keywords: 'alert callout caution',
      run: (v) => void insertCallout('WARNING')(v),
    },
    {
      name: 'image',
      detail: 'Upload an image',
      keywords: 'picture photo',
      run: (v) => host.pickFile(v, true),
    },
    {
      name: 'file',
      detail: 'Attach a file',
      keywords: 'attachment upload',
      run: (v) => host.pickFile(v, false),
    },
    { name: 'date', detail: 'Today’s date', keywords: 'today', run: (v) => void insertDate(v) },
    {
      name: 'h1',
      detail: 'Heading 1',
      keywords: 'heading title',
      run: (v) => void setHeading(1)(v),
    },
    { name: 'h2', detail: 'Heading 2', keywords: 'heading', run: (v) => void setHeading(2)(v) },
    { name: 'h3', detail: 'Heading 3', keywords: 'heading', run: (v) => void setHeading(3)(v) },
    {
      name: 'todo',
      detail: 'Task list',
      keywords: 'task checkbox',
      run: (v) => void toggleList('task')(v),
    },
    {
      name: 'list',
      detail: 'Bullet list',
      keywords: 'bullet',
      run: (v) => void toggleList('bullet')(v),
    },
    {
      name: 'numbered',
      detail: 'Numbered list',
      keywords: 'ordered',
      run: (v) => void toggleList('ordered')(v),
    },
    { name: 'quote', detail: 'Quote', run: (v) => void toggleQuote(v) },
    {
      name: 'divider',
      detail: 'Horizontal line',
      keywords: 'rule hr',
      run: (v) => void insertRule(v),
    },
  ];
}

function slashSource(host: CompletionHost) {
  const commands = slashCommands(host);
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/(?:^|\s)\/[\w-]*$/);
    if (!match) return null;
    const slash = match.from + match.text.indexOf('/');
    const line = context.state.doc.lineAt(slash);
    // Only as the start of a word, and not inside code.
    if (/`/.test(line.text.slice(0, slash - line.from))) return null;
    return {
      from: slash,
      options: commands.map((command): Completion => ({
        label: `/${command.name}`,
        detail: command.detail,
        ...(command.keywords ? { info: command.keywords } : {}),
        apply: (view, _completion, from, to) => {
          view.dispatch({ changes: { from, to }, selection: { anchor: from } });
          command.run(view);
        },
      })),
      validFor: /^\/[\w-]*$/,
    };
  };
}

function wikiSource(host: CompletionHost) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[[^[\]|\n]*$/);
    if (!match) return null;
    const query = match.text.slice(2);
    const pages = host
      .pages()
      .filter((p) => p.title)
      .map((p) => ({ page: p, score: query ? fuzzyScore(query, p.title) : 0 }))
      .filter((p) => p.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 50);
    const closed = context.state.sliceDoc(context.pos, context.pos + 2) === ']]';
    return {
      from: match.from + 2,
      options: pages.map(({ page }): Completion => ({
        label: page.title,
        apply: (view, _completion, from, to) => {
          const insert = closed ? page.title : `${page.title}]]`;
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + page.title.length + 2 },
          });
        },
      })),
      filter: false,
    };
  };
}

export function completions(host: CompletionHost) {
  return autocompletion({
    override: [slashSource(host), wikiSource(host)],
    icons: false,
    defaultKeymap: true,
    activateOnTyping: true,
  });
}
