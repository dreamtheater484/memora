import { history, undo } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ChangeSet, EditorSelection, EditorState, Text } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { isDiagramLanguage } from '@memora/shared';
import type { Element, ElementContent, Root } from 'hast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramEditRequest } from '../diagrams/open';
import { toHast } from '../markdown/pipeline';
import {
  diagramFences,
  drawnDiagrams,
  fenceAtLine,
  fenceChange,
  fencesIn,
  locateFence,
} from './diagrams';

const requests = vi.hoisted(() => [] as DiagramEditRequest[]);
vi.mock('../diagrams/open', () => ({
  openDiagramEditor: (request: DiagramEditRequest) => requests.push(request),
}));
vi.mock('../diagrams/render', () => ({
  renderDiagram: () => Promise.resolve({ svg: '<svg role="img"></svg>' }),
}));

/** Diagrams in every kind of container, and look-alikes that aren't fences. */
const PAGE = [
  '# Plan',
  '',
  '- First',
  '  ```Mermaid',
  '  flowchart LR',
  '    A --> B',
  '  ```',
  '- Second',
  '',
  '10. Tenth',
  '    ```mermaid',
  '    pie title Ten',
  '    ```',
  '',
  '> [!NOTE]',
  '> ```MERMAID',
  '> sequenceDiagram',
  '>   A->>B: Hi',
  '>',
  '>   B-->>A: Bye',
  '> ```',
  '',
  '- Outer',
  '  1. Inner',
  '     > ```mermaid',
  '     > mindmap',
  '     >   root((Goals))',
  '     > ```',
  '',
  '```js',
  '```mermaid',
  '```',
  '',
  '    ```mermaid',
  '    indented code',
  '    ```',
  '',
  '- ```mermaid',
  '  graph TD',
  '  ```',
  '',
  'The end',
].join('\n');

const CODES = [
  'flowchart LR\n  A --> B',
  'pie title Ten',
  'sequenceDiagram\n  A->>B: Hi\n\n  B-->>A: Bye',
  'mindmap\n  root((Goals))',
  'graph TD',
];

const textOf = (node: ElementContent | Root): string =>
  node.type === 'text'
    ? node.value
    : node.type === 'element' || node.type === 'root'
      ? node.children.map((c) => textOf(c as ElementContent)).join('')
      : '';

/** The diagrams the preview finds, with their code as it reads it. */
function previewDiagrams(markdownText: string): string[] {
  const found: string[] = [];
  const walk = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      const classes = child.properties.className;
      const language = Array.isArray(classes)
        ? classes.map(String).find((c) => c.startsWith('language-'))
        : undefined;
      if (child.tagName === 'code' && language && isDiagramLanguage(language.slice(9))) {
        found.push(textOf(child).replace(/\n$/, ''));
      }
      walk(child);
    }
  };
  walk(toHast(markdownText));
  return found;
}

/** The page's structure: its elements, without any text. */
function shape(markdownText: string): string {
  const walk = (node: Root | Element): string => {
    let out = '';
    for (const child of node.children) {
      if (child.type === 'element') out += `${child.tagName}(${walk(child)})`;
    }
    return out;
  };
  return walk(toHast(markdownText));
}

const apply = (text: string, change: { from: number; to: number; insert: string }) =>
  text.slice(0, change.from) + change.insert + text.slice(change.to);

describe('diagram fences in the Markdown source', () => {
  const doc = Text.of(PAGE.split('\n'));

  it('finds them in lists, numbered items, callouts and nested containers, in any case', () => {
    const fences = diagramFences(doc);
    expect(fences.map((f) => f.code)).toEqual(CODES);
    expect(fences.map((f) => doc.lineAt(f.from).number)).toEqual([4, 11, 16, 25, 38]);
    expect(fences.map((f) => f.prefix)).toEqual(['  ', '    ', '> ', '     > ', '  ']);
    expect(fences.every((f) => f.closed)).toBe(true);
    // As the preview reads them.
    expect(previewDiagrams(PAGE)).toEqual(CODES);
  });

  it('writes code back keeping every line’s prefix, so the page keeps its structure', () => {
    const before = shape(PAGE);
    const code = 'flowchart TD\n  X[New] --> Y\n\n  Y --> Z';
    diagramFences(doc).forEach((fence, i) => {
      const next = apply(PAGE, fenceChange(fence, code));
      const expected = CODES.map((c, j) => (j === i ? code : c));
      expect(previewDiagrams(next), `diagram ${i + 1}`).toEqual(expected);
      expect(shape(next), `diagram ${i + 1}`).toBe(before);
      expect(diagramFences(Text.of(next.split('\n'))).map((f) => f.code)).toEqual(expected);
    });
    const callout = diagramFences(doc)[2]!;
    expect(apply(PAGE, fenceChange(callout, 'pie\n\n  "a" : 1')).split('\n').slice(14, 20)).toEqual(
      ['> [!NOTE]', '> ```MERMAID', '> pie', '>', '>   "a" : 1', '> ```'],
    );
  });

  it('keeps the fence’s own indentation, and fills an empty fence', () => {
    const page = '- item\n\n   ```mermaid\n    graph\n   ```\n\n```mermaid\n```';
    const [indented, empty] = diagramFences(Text.of(page.split('\n')));
    expect(indented!.code).toBe(' graph');
    expect(previewDiagrams(page)[0]).toBe(' graph');
    expect(apply(page, fenceChange(indented!, 'pie\n x'))).toBe(
      '- item\n\n   ```mermaid\n   pie\n    x\n   ```\n\n```mermaid\n```',
    );
    expect(empty!.code).toBe('');
    expect(apply(page, fenceChange(empty!, 'pie'))).toBe(`${page.slice(0, -3)}pie\n\`\`\``);
  });

  it('finds the fence on a line, and again after the page changed', () => {
    expect(fenceAtLine(doc, 27)?.code).toBe(CODES[3]);
    expect(fenceAtLine(doc, 25)?.code).toBe(CODES[3]);
    expect(fenceAtLine(doc, 29)).toBeNull();
    const fence = diagramFences(doc)[1]!;
    const moved = Text.of(`Intro\n\n${PAGE}`.split('\n'));
    expect(locateFence(moved, fence)?.from).toBe(fence.from + 7);
  });

  it('keeps fences beyond what the parser has reached', () => {
    const fences = diagramFences(doc);
    // A tree that only reaches the second diagram's end.
    const partial = markdownLanguage.parser.parse(doc.sliceString(0, fences[1]!.to + 1));
    const found = fencesIn(doc, partial, fences, ChangeSet.empty(doc.length));
    expect(found.map((f) => f.code)).toEqual(CODES);
  });
});

describe('diagrams drawn in the source view', () => {
  // jsdom's editor puts only the first two drawings on screen.
  const SHORT = [
    '- Outer',
    '  1. Inner',
    '     > ```mermaid',
    '     > mindmap',
    '     > ```',
    '',
    '> [!NOTE]',
    '> ```MERMAID',
    '> pie',
    '> ```',
    '- First',
    '  ```Mermaid',
    '  flowchart LR',
    '  ```',
  ].join('\n');
  let view: EditorView;

  beforeEach(() => {
    requests.length = 0;
    view = new EditorView({
      parent: document.body.appendChild(document.createElement('div')),
      state: EditorState.create({
        doc: SHORT,
        selection: EditorSelection.cursor(0),
        extensions: [history(), markdown({ base: markdownLanguage }), drawnDiagrams()],
      }),
    });
  });
  afterEach(() => view.destroy());

  const drawn = () => [...view.dom.querySelectorAll<HTMLElement>('.cm-diagram')];
  /** The lines of the blocks drawn, on screen or not. */
  const drawnLines = () =>
    view.state.facet(EditorView.decorations).flatMap((source) => {
      const set = typeof source === 'function' ? source(view) : source;
      const lines: number[] = [];
      for (const it = set.iter(); it.value; it.next()) {
        if (it.value.spec.widget) lines.push(view.state.doc.lineAt(it.from).number);
      }
      return lines;
    });
  const button = (diagram: HTMLElement, name: string) =>
    [...diagram.querySelectorAll('button')].find((b) => b.textContent === name)!;
  const line = (n: number) => view.state.doc.line(n);

  it('draws each one, indented like its code', () => {
    expect(drawnLines()).toEqual([3, 8, 12]);
    expect(drawn().map((d) => d.style.getPropertyValue('--cm-diagram-indent'))).toEqual(['7', '2']);
  });

  it('shows the code from the button and from the arrow keys', () => {
    button(drawn()[1]!, 'Show code').click();
    const head = view.state.selection.main.head;
    expect(view.state.doc.lineAt(head).number).toBe(9);
    expect(view.state.sliceDoc(head, head + 3)).toBe('pie');
    expect(drawnLines()).toEqual([3, 12]);

    view.dispatch({ selection: { anchor: line(7).from }, userEvent: 'select' });
    expect(drawnLines()).toEqual([3, 8, 12]);
    runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'ArrowDown' }), 'editor');
    expect(view.state.selection.main.head).toBe(line(8).from);
    expect(drawnLines()).toEqual([3, 12]);
  });

  it('puts the diagram editor’s code back with the container’s prefixes, in one change', () => {
    button(drawn()[0]!, 'Edit diagram').click();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.code).toBe('mindmap');
    requests[0]!.onDone('mindmap\n  root((Goals))\n    Ship\n\n    Learn');
    expect(view.state.doc.toString().split('\n').slice(0, 10)).toEqual([
      '- Outer',
      '  1. Inner',
      '     > ```mermaid',
      '     > mindmap',
      '     >   root((Goals))',
      '     >     Ship',
      '     >',
      '     >     Learn',
      '     > ```',
      '',
    ]);
    expect(shape(view.state.doc.toString())).toBe(shape(SHORT));
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(SHORT);
  });
});
