import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { editorTheme, markdownHighlight } from '../../editor/theme';

/*
 * A diagram's Mermaid code (§9.3, §9.4): for diagram types without a visual editor, and in
 * Markdown pages beside the visual editor. Keywords, arrows, strings and comments coloured.
 */

const KEYWORDS =
  /^(?:flowchart|graph|subgraph|end|direction|classDef|class|style|linkStyle|click|sequenceDiagram|participant|actor|as|loop|alt|else|opt|par|and|critical|option|break|rect|note|over|left|right|of|activate|deactivate|autonumber|title|mindmap|timeline|section|gantt|dateFormat|axisFormat|excludes|todayMarker|pie|showData|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|quadrantChart|gitGraph|commit|branch|checkout|merge|accTitle|accDescr|TB|TD|BT|LR|RL)\b/;

const mermaidLanguage = StreamLanguage.define({
  name: 'mermaid',
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"[^"]*"?/)) return 'string';
    if (
      stream.match(
        /^(?:<<)?[-=.~ox<]*(?:-->>|->>|-->|---|-\.->|==>|===|~~~|->|-x|--x|-\)|--\)|-\.-)[>xo]?/,
      )
    )
      return 'operator';
    if (stream.match(/^\d+(?:\.\d+)?[a-zA-Z%]*/)) return 'number';
    if (stream.match(KEYWORDS)) return 'keyword';
    if (stream.match(/^[[\](){}|:;,&]/)) return 'punctuation';
    stream.next();
    return null;
  },
});

export function CodePane({
  code,
  onChange,
  label,
}: {
  code: string;
  onChange: (code: string) => void;
  label: string;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const cm = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          mermaidLanguage,
          syntaxHighlighting(markdownHighlight),
          editorTheme,
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = cm;
    return () => {
      cm.destroy();
      view.current = null;
    };
    // Made once; outside changes (undo, the visual editor) arrive below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cm = view.current;
    if (!cm) return;
    const current = cm.state.doc.toString();
    if (current !== code) cm.dispatch({ changes: { from: 0, to: current.length, insert: code } });
  }, [code]);

  return <div ref={parent} className="diagram-code" />;
}
