import { markdownLanguage } from '@codemirror/lang-markdown';
import { DocInput, ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import {
  DIAGRAM_LANGUAGE,
  columnsOf,
  fencePrefix,
  isDiagramLanguage,
  prefixFenceLines,
  stripFencePrefix,
} from '@memora/shared';
import {
  EditorSelection,
  Prec,
  StateField,
  Transaction,
  type ChangeDesc,
  type EditorState,
  type Extension,
  type Range,
  type Text,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { openDiagramEditor } from '../diagrams/open';
import { resolvedTheme, useTheme } from '../theme/theme';
import { insertBlock } from './commands';

/*
 * Diagrams in the Markdown source view (§9.3): each ```mermaid block (in any case) is drawn
 * in place of its code while the cursor is elsewhere, with "Edit diagram" (the visual editor)
 * and "Show code". The arrow keys go into a block, which shows its code; leaving it draws it
 * again. The diagram editor's result replaces the code in one change, undone at once.
 *
 * Fences are found in the Markdown syntax tree, so blocks in list items and quotes (callouts
 * too) count, at any depth, as in the preview. Their lines start with the containers' markers
 * and indentation: the code is read without them and written back with them (fences.ts in
 * @memora/shared), so the page's structure stays as it was.
 */

type Tree = ReturnType<typeof syntaxTree>;
type SyntaxNode = Tree['topNode'];

export interface Fence {
  /** Start of the opening fence line. */
  from: number;
  /** End of the closing fence line (or of the last line of code, for an unclosed fence). */
  to: number;
  /** The lines of code, prefixes and all: the start of the first and the end of the last. */
  bodyFrom: number;
  bodyTo: number;
  /** How many lines of code there are; with none, bodyFrom and bodyTo are the opening's end. */
  lines: number;
  /** Where the code starts, after the first line's prefix. */
  codeFrom: number;
  /** The code, without the lines' prefixes. */
  code: string;
  closed: boolean;
  /** What each line of code starts with: the containers' markers and indentation. */
  prefix: string;
}

/** The blocks a fence can be in. */
const CONTAINERS = new Set(['Document', 'Blockquote', 'BulletList', 'OrderedList', 'ListItem']);

function readFence(doc: Text, node: SyntaxNode): Fence | null {
  const info = node.getChild('CodeInfo');
  const language = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : '';
  if (!isDiagramLanguage(language)) return null;
  const open = doc.lineAt(node.from);
  const marks = node.getChildren('CodeMark');
  const closing = marks.length > 1 ? marks[marks.length - 1]! : null;
  const closed = !!closing && closing.from > open.to;
  const last = closed ? doc.lineAt(closing.from) : doc.lineAt(Math.max(node.to, open.to));
  const lastCode = closed ? last.number - 1 : last.number;
  const prefix = fencePrefix(doc.sliceString(open.from, node.from));
  const code: string[] = [];
  for (let n = open.number + 1; n <= lastCode; n++) {
    code.push(stripFencePrefix(doc.line(n).text, prefix));
  }
  const first = code.length ? doc.line(open.number + 1) : null;
  return {
    from: open.from,
    to: closed ? last.to : first ? doc.line(lastCode).to : open.to,
    bodyFrom: first ? first.from : open.to,
    bodyTo: first ? doc.line(lastCode).to : open.to,
    lines: code.length,
    codeFrom: first ? Math.max(first.from, first.to - code[0]!.length) : open.to,
    code: code.join('\n'),
    closed,
    prefix,
  };
}

/** The whole document's syntax tree, parsed here (outside an editor). */
const parse = (doc: Text): Tree => markdownLanguage.parser.parse(new DocInput(doc));

/**
 * The diagram fences in a document, from its Markdown syntax tree (the editor's, which may
 * not reach the end yet, or else one parsed here). Other fenced code is skipped.
 */
export function diagramFences(doc: Text, tree: Tree = parse(doc)): Fence[] {
  const fences: Fence[] = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === 'FencedCode') {
        const fence = readFence(doc, node.node);
        if (fence) fences.push(fence);
        return false;
      }
      // Only blocks that can hold one are looked into.
      return CONTAINERS.has(node.name);
    },
  });
  return fences;
}

/** The diagram fence a line is in. */
export function fenceAtLine(doc: Text, line: number): Fence | null {
  if (line < 1 || line > doc.lines) return null;
  const at = doc.line(line).from;
  return diagramFences(doc).find((f) => f.from <= at && at <= f.to) ?? null;
}

/** A fence found again after the page changed: at the same place, or by its code. */
export function locateFence(
  doc: Text,
  fence: Fence,
  fences: Fence[] = diagramFences(doc),
): Fence | null {
  return (
    fences.find((f) => f.from === fence.from && f.code === fence.code) ??
    fences.find((f) => f.code === fence.code) ??
    null
  );
}

/**
 * The change that puts `code` in a fence: its lines replaced, each with the fence's prefix,
 * so a fence in a list item or a quote stays in it.
 */
export function fenceChange(
  fence: Fence,
  code: string,
): { from: number; to: number; insert: string } {
  const text = prefixFenceLines(code, fence.prefix);
  return fence.lines
    ? { from: fence.bodyFrom, to: fence.bodyTo, insert: text }
    : { from: fence.bodyFrom, to: fence.bodyFrom, insert: `\n${text}` };
}

/** The fences the editor knows of (those drawn), or else the document's. */
const fencesOf = (state: EditorState): Fence[] =>
  state.field(field, false)?.fences ?? diagramFences(state.doc);

/** Opens the diagram editor for a fence, putting the result back in its place. */
export function editFence(view: EditorView, fence: Fence) {
  openDiagramEditor({
    code: fence.code,
    page: 'markdown',
    onDone: (code) => {
      if (code === fence.code) return;
      const target = locateFence(view.state.doc, fence, fencesOf(view.state));
      if (!target) return;
      view.dispatch({ changes: fenceChange(target, code), userEvent: 'input.diagram' });
      view.focus();
    },
  });
}

/** Starts a new diagram from the template gallery, inserted at the cursor when done. */
export function newDiagram(view: EditorView): boolean {
  openDiagramEditor({
    code: null,
    page: 'markdown',
    onDone: (code) => {
      const text = `\`\`\`${DIAGRAM_LANGUAGE}\n${code}\n\`\`\``;
      insertBlock(view, text, text.length);
      // The cursor goes after the block, so it is drawn.
      const { head } = view.state.selection.main;
      const line = view.state.doc.lineAt(head);
      if (line.number < view.state.doc.lines) {
        view.dispatch({ selection: { anchor: view.state.doc.line(line.number + 1).from } });
      }
    },
  });
  return true;
}

const themeNow = () => resolvedTheme(useTheme.getState().theme);

class DiagramWidget extends WidgetType {
  constructor(
    readonly fence: Fence,
    readonly theme: 'light' | 'dark',
  ) {
    super();
  }

  override eq(other: DiagramWidget) {
    return (
      other.fence.code === this.fence.code &&
      other.fence.prefix === this.fence.prefix &&
      other.theme === this.theme
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-diagram';
    // Indented like the code it stands for, in a list item or a quote.
    const indent = columnsOf(this.fence.prefix);
    if (indent) wrap.style.setProperty('--cm-diagram-indent', String(indent));
    const drawing = document.createElement('div');
    drawing.className = 'diagram-drawing';
    drawing.dataset.state = 'waiting';
    const spinner = document.createElement('span');
    spinner.className = 'diagram-waiting';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-label', 'Drawing the diagram…');
    drawing.append(spinner);
    const code = this.fence.code;
    if (code.trim()) {
      void import('../diagrams/render')
        .then(({ renderDiagram }) => renderDiagram(code, this.theme))
        .then(
          (d) => {
            drawing.dataset.state = 'drawn';
            // Sanitised by Mermaid's strict mode and again in render.ts.
            drawing.innerHTML = d.svg;
            view.requestMeasure();
          },
          (error: unknown) => {
            drawing.dataset.state = 'failed';
            const message = document.createElement('p');
            message.className = 'diagram-error';
            message.textContent = `Diagram: ${error instanceof Error ? error.message : 'a mistake'}`;
            drawing.replaceChildren(message);
          },
        );
    } else {
      drawing.dataset.state = 'failed';
      const empty = document.createElement('p');
      empty.className = 'diagram-error';
      empty.textContent = 'An empty diagram.';
      drawing.replaceChildren(empty);
    }
    const tools = document.createElement('div');
    tools.className = 'cm-diagram-tools';
    const button = (label: string, run: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', run);
      return b;
    };
    // The fence as it is now: text above it may have moved it since it was drawn.
    const current = () => {
      const at = view.posAtDOM(wrap);
      return fencesOf(view.state).find((f) => f.from === at) ?? this.fence;
    };
    tools.append(
      button('Edit diagram', () => editFence(view, current())),
      button('Show code', () => {
        view.dispatch({
          selection: { anchor: current().codeFrom },
          scrollIntoView: true,
          userEvent: 'select',
        });
        view.focus();
      }),
    );
    wrap.append(drawing, tools);
    wrap.addEventListener('dblclick', () => editFence(view, current()));
    return wrap;
  }

  override get estimatedHeight() {
    return 260;
  }

  override ignoreEvent() {
    return true;
  }
}

interface DiagramState {
  fences: Fence[];
  /** The syntax tree they were found in. */
  tree: Tree;
  theme: 'light' | 'dark';
  /** Whether the cursor was put somewhere (typing, clicking, keys) since the page opened. */
  placed: boolean;
  decorations: DecorationSet;
}

function moved(fence: Fence, changes: ChangeDesc): Fence {
  const map = (pos: number) => changes.mapPos(pos);
  return {
    ...fence,
    from: map(fence.from),
    to: map(fence.to),
    bodyFrom: map(fence.bodyFrom),
    bodyTo: map(fence.bodyTo),
    codeFrom: map(fence.codeFrom),
  };
}

/**
 * The fences in the editor's syntax tree. On a long page the tree may not reach the end yet
 * (just opened, or just changed): further down, the fences stay as they were until it does.
 */
export function fencesIn(doc: Text, tree: Tree, before: Fence[], changes: ChangeDesc): Fence[] {
  const found = diagramFences(doc, tree);
  if (tree.length >= doc.length) return found;
  const parsed = found.filter((f) => f.to < tree.length);
  const after = parsed.at(-1)?.to ?? -1;
  const rest = before
    .filter((f) => !changes.touchesRange(f.from, f.to))
    .map((f) => moved(f, changes))
    .filter((f) => f.from > after && f.to >= tree.length);
  return [...parsed, ...rest];
}

/**
 * A fence the selection touches shows its code, once the cursor was put somewhere: a page
 * that opens with a diagram first shows it drawn, though the cursor starts in it.
 */
function decorate(
  state: EditorState,
  fences: Fence[],
  theme: 'light' | 'dark',
  placed: boolean,
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const fence of fences) {
    if (!fence.closed) continue;
    const touched =
      placed && state.selection.ranges.some((r) => r.to >= fence.from && r.from <= fence.to);
    if (touched) continue;
    ranges.push(
      Decoration.replace({ widget: new DiagramWidget(fence, theme), block: true }).range(
        fence.from,
        fence.to,
      ),
    );
  }
  return Decoration.set(ranges);
}

/** How long opening a page may spend parsing it, so its diagrams are drawn from the start. */
const OPEN_PARSE_MS = 50;

const field = StateField.define<DiagramState>({
  create(state) {
    const tree = ensureSyntaxTree(state, state.doc.length, OPEN_PARSE_MS) ?? syntaxTree(state);
    const fences = diagramFences(state.doc, tree);
    const theme = themeNow();
    return {
      fences,
      tree,
      theme,
      placed: false,
      decorations: decorate(state, fences, theme, false),
    };
  },
  update(value, tr) {
    const theme = themeNow();
    // The tree also changes as the parser gets further down a long page.
    const tree = syntaxTree(tr.state);
    const reparsed = tree !== value.tree && tree !== syntaxTree(tr.startState);
    if (!tr.docChanged && !tr.selection && theme === value.theme && !reparsed) return value;
    const fences =
      tr.docChanged || reparsed
        ? fencesIn(tr.state.doc, tree, value.fences, tr.changes)
        : value.fences;
    // Typing, clicking and keys; not the page's text arriving (from the server, another tab).
    const placed =
      value.placed ||
      ((tr.docChanged || !!tr.selection) && tr.annotation(Transaction.userEvent) !== undefined);
    return {
      fences,
      tree: tr.docChanged || reparsed ? tree : value.tree,
      theme,
      placed,
      decorations: decorate(tr.state, fences, theme, placed),
    };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/** The arrow keys step into a drawn block (showing its code) rather than over it. */
const enter = (forward: boolean) => (view: EditorView) => {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty) return false;
  const line = state.doc.lineAt(range.head);
  const next = forward ? line.number + 1 : line.number - 1;
  if (next < 1 || next > state.doc.lines) return false;
  const target = state.doc.line(next);
  const { fences } = state.field(field);
  const fence = fences.find((f) => (forward ? f.from === target.from : f.to === target.to));
  if (!fence) return false;
  view.dispatch({
    selection: EditorSelection.cursor(forward ? fence.from : fence.to),
    scrollIntoView: true,
    userEvent: 'select',
  });
  return true;
};

export function drawnDiagrams(): Extension {
  return [
    field,
    Prec.high(
      keymap.of([
        { key: 'ArrowDown', run: enter(true) },
        { key: 'ArrowUp', run: enter(false) },
      ]),
    ),
  ];
}

/** Draws the diagrams again in the app's light or dark look, after it changed. */
export function refreshDiagrams(view: EditorView) {
  if (view.state.field(field, false)) view.dispatch({});
}
