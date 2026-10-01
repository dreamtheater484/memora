import { DIAGRAM_LANGUAGE } from '@memora/shared';
import {
  EditorSelection,
  Prec,
  StateField,
  Transaction,
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
 * Diagrams in the Markdown source view (§9.3): each ```mermaid block is drawn in place of its
 * code while the cursor is elsewhere, with "Edit diagram" (the visual editor) and "Show code".
 * The arrow keys go into a block, which shows its code; leaving it draws it again. The
 * diagram editor's result replaces the code between the fences in one change, undone at once.
 */

export interface Fence {
  /** Start of the opening fence line. */
  from: number;
  /** End of the closing fence line (or of the document, for an unclosed fence). */
  to: number;
  /** The code between the fences. */
  codeFrom: number;
  codeTo: number;
  code: string;
  closed: boolean;
}

const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** The diagram fences in a document; other fenced code is skipped, with what it holds. */
export function diagramFences(doc: Text): Fence[] {
  const fences: Fence[] = [];
  let n = 1;
  while (n <= doc.lines) {
    const line = doc.line(n);
    const open = OPEN.exec(line.text);
    if (!open) {
      n += 1;
      continue;
    }
    const marker = open[2]!;
    const info = open[3]!.trim();
    // A backtick fence's info can't contain backticks; such a line isn't a fence.
    if (marker[0] === '`' && info.includes('`')) {
      n += 1;
      continue;
    }
    const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    let end = n + 1;
    while (end <= doc.lines && !closing.test(doc.line(end).text)) end += 1;
    const closed = end <= doc.lines;
    if (info.split(/\s+/)[0] === DIAGRAM_LANGUAGE) {
      const first = n + 1;
      const last = closed ? end - 1 : doc.lines;
      const codeFrom = first <= doc.lines ? doc.line(first).from : line.to;
      const codeTo = last >= first ? doc.line(last).to : codeFrom;
      fences.push({
        from: line.from,
        to: closed ? doc.line(end).to : doc.length,
        codeFrom,
        codeTo,
        code: doc.sliceString(codeFrom, codeTo),
        closed,
      });
    }
    n = end + 1;
  }
  return fences;
}

/** The diagram fence a line is in. */
export function fenceAtLine(doc: Text, line: number): Fence | null {
  if (line < 1 || line > doc.lines) return null;
  const at = doc.line(line).from;
  return diagramFences(doc).find((f) => f.from <= at && at <= f.to) ?? null;
}

/** A fence found again after the page changed: at the same place, or by its code. */
export function locateFence(doc: Text, fence: Fence): Fence | null {
  const fences = diagramFences(doc);
  return (
    fences.find((f) => f.from === fence.from && f.code === fence.code) ??
    fences.find((f) => f.code === fence.code) ??
    null
  );
}

/** Opens the diagram editor for a fence, putting the result back between its fences. */
export function editFence(view: EditorView, fence: Fence) {
  openDiagramEditor({
    code: fence.code,
    page: 'markdown',
    onDone: (code) => {
      if (code === fence.code) return;
      const target = locateFence(view.state.doc, fence);
      if (!target) return;
      view.dispatch({
        changes: { from: target.codeFrom, to: target.codeTo, insert: code },
        userEvent: 'input.diagram',
      });
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
    return other.fence.code === this.fence.code && other.theme === this.theme;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('div');
    wrap.className = 'cm-diagram';
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
      return diagramFences(view.state.doc).find((f) => f.from === at) ?? this.fence;
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
  theme: 'light' | 'dark';
  /** Whether the cursor was put somewhere (typing, clicking, keys) since the page opened. */
  placed: boolean;
  decorations: DecorationSet;
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

const field = StateField.define<DiagramState>({
  create(state) {
    const fences = diagramFences(state.doc);
    const theme = themeNow();
    return { fences, theme, placed: false, decorations: decorate(state, fences, theme, false) };
  },
  update(value, tr) {
    const theme = themeNow();
    if (!tr.docChanged && !tr.selection && theme === value.theme) return value;
    const fences = tr.docChanged ? diagramFences(tr.state.doc) : value.fences;
    // Typing, clicking and keys; not the page's text arriving (from the server, another tab).
    const placed =
      value.placed ||
      ((tr.docChanged || !!tr.selection) && tr.annotation(Transaction.userEvent) !== undefined);
    return { fences, theme, placed, decorations: decorate(tr.state, fences, theme, placed) };
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
