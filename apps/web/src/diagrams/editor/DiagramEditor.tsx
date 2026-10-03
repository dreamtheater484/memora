import {
  DIAGRAM_NAMES,
  detectDiagram,
  parseDiagram,
  printDiagram,
  type DiagramModel,
  type Flowchart,
  type Gantt,
  type Mindmap,
  type Pie,
  type SequenceDiagram,
  type Timeline,
} from '@memora/shared';
import { Code2, Keyboard, LayoutTemplate, Redo2, Shapes, Undo2 } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button, IconButton, SegmentedControl } from '../../components/ui';
import { overlayClass } from '../../components/ui/Dialog';
import { keysLabel } from '../../shell/shortcuts';
import { useShell } from '../../shell/store';
import { Canvas, type CanvasControls, type CanvasView } from './Canvas';
import { GanttPanel, PiePanel, TimelinePanel } from './charts';
import { CodePane } from './CodePane';
import { EditEpoch } from './epoch';
import { FlowchartExtras, FlowchartPanel } from './flowchart';
import { Gallery } from './Gallery';
import { boxesWithin, hitMap } from './hits';
import type { EditEnd } from './InlineEditor';
import { KeySheet } from './KeySheet';
import { afterEdit, keyAction, stillThere, type EditStart, type Outcome } from './keys';
import { textOf, withText } from './labels';
import { MindmapPanel } from './mindmap';
import { EditorOverlay } from './Overlay';
import type { ChangeOptions, PanelProps } from './panel';
import {
  itemKey,
  itemsOf,
  toSelection,
  type Item,
  type Selectable,
  type Selection,
} from './selection';
import { SequencePanel } from './sequence';
import './editor.css';

/*
 * The diagram editor (§9.3, §9.4): full screen, the diagram in the middle and its details
 * beside it (below it on a phone). Flowcharts, mind maps, sequence diagrams, timelines,
 * Gantt charts and pie charts are edited visually: on the drawing (select, edit words in
 * place, keys after MindManager's) and in the panel, which always agree; other diagrams, and
 * any code the visual editor can't take, as Mermaid code with a live drawing. Markdown pages
 * can switch to the code too. One undo history for all of it, with what was selected; Done
 * puts the result in the page as one change.
 */

interface Props {
  code: string | null;
  page: 'markdown' | 'rich';
  onDone: (code: string) => void;
}

interface Snapshot {
  code: string;
  selection: Selection;
}

interface History {
  past: Snapshot[];
  present: string;
  future: Snapshot[];
  selection: Selection;
  /** What the last change was (typing in one field is one step), and when. */
  merge: string | null;
  at: number;
  /** Goes up with every change but typing in a field: the panel's fields read it again. */
  epoch: number;
}

const HISTORY = 200;
const ZOOM_KEYS: Record<string, 'in' | 'out' | 'fit'> = {
  Equal: 'in',
  NumpadAdd: 'in',
  Minus: 'out',
  NumpadSubtract: 'out',
  Digit0: 'fit',
  Numpad0: 'fit',
};

const isTyping = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.(
    'input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"]',
  );

export default function DiagramEditorDialog({ code, page, onDone }: Props) {
  const initial = code ?? '';
  const [history, setHistory] = useState<History>({
    past: [],
    present: initial,
    future: [],
    selection: null,
    merge: null,
    at: 0,
    epoch: 0,
  });
  const [phase, setPhase] = useState<'gallery' | 'edit'>(code === null ? 'gallery' : 'edit');
  const [view, setView] = useState<'visual' | 'code'>('visual');
  const [confirming, setConfirming] = useState<'close' | 'template' | null>(null);
  const [keySheet, setKeySheet] = useState(false);
  const [editing, setEditing] = useState<EditStart | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const present = history.present;
  const presentNow = useRef(present);
  useLayoutEffect(() => {
    presentNow.current = present;
  });
  const parsed = useMemo(() => parseDiagram(present), [present]);
  const type = detectDiagram(present) ?? 'other';
  const dirty = present !== initial;
  const visual = parsed.ok && view === 'visual';
  const model = visual && parsed.ok ? parsed.model : null;
  // What was selected may be gone (an undo, the code changed): only what is still there.
  const selection = useMemo(
    () => (model ? stillThere(model, history.selection) : null),
    [model, history.selection],
  );

  /** A new version of the code: one step of the history, or part of the last (`merge`). */
  const commit = useCallback(
    (next: string, options: { merge?: string; select?: Selectable } = {}) => {
      setHistory((h) => {
        const selection = 'select' in options ? toSelection(options.select ?? null) : h.selection;
        if (next === h.present) return { ...h, selection };
        const now = Date.now();
        const epoch = options.merge ? h.epoch : h.epoch + 1;
        if (options.merge && options.merge === h.merge && now - h.at < 1500) {
          return { ...h, present: next, selection, future: [], at: now, epoch };
        }
        return {
          past: [...h.past, { code: h.present, selection: h.selection }].slice(-HISTORY),
          present: next,
          future: [],
          selection,
          merge: options.merge ?? null,
          at: now,
          epoch,
        };
      });
    },
    [],
  );
  const undo = useCallback(() => {
    setEditing(null);
    setHistory((h) => {
      const last = h.past.at(-1);
      if (!last) return h;
      return {
        past: h.past.slice(0, -1),
        present: last.code,
        future: [{ code: h.present, selection: h.selection }, ...h.future],
        selection: last.selection,
        merge: null,
        at: 0,
        epoch: h.epoch + 1,
      };
    });
  }, []);
  const redo = useCallback(() => {
    setEditing(null);
    setHistory((h) => {
      const next = h.future[0];
      if (!next) return h;
      return {
        past: [...h.past, { code: h.present, selection: h.selection }],
        present: next.code,
        future: h.future.slice(1),
        selection: next.selection,
        merge: null,
        at: 0,
        epoch: h.epoch + 1,
      };
    });
  }, []);

  // The drawing and which of its elements is which item, from the code it was drawn from.
  const canvasView = useRef<CanvasView | null>(null);
  const controls = useRef<CanvasControls | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const [drawn, setDrawn] = useState<{ svg: SVGSVGElement; code: string } | null>(null);
  const onDrawn = useCallback(
    (svg: SVGSVGElement, drawnCode: string) => setDrawn({ svg, code: drawnCode }),
    [],
  );
  const map = useMemo(() => {
    if (!drawn) return hitMap(null, null);
    const result = parseDiagram(drawn.code);
    return hitMap(drawn.svg, result.ok ? result.model : null);
  }, [drawn]);

  const focusCanvas = () => canvasView.current?.viewport?.focus({ preventScroll: true });

  // A selection made by keys or in the panel is brought into sight on the drawing (once it
  // is drawn); one made on the drawing scrolls the panel to its row.
  const reveal = useRef(false);
  const select = useCallback((next: Selectable) => {
    reveal.current = true;
    setHistory((h) => ({ ...h, selection: toSelection(next) }));
  }, []);
  const pick = useCallback((next: Selectable) => {
    setHistory((h) => ({ ...h, selection: toSelection(next) }));
  }, []);
  useEffect(() => {
    const item = itemsOf(selection).at(-1);
    if (!item) return;
    if (reveal.current) {
      const v = canvasView.current;
      const hit = map.hitOf(item);
      if (v && hit?.elements[0]) {
        reveal.current = false;
        controls.current?.reveal(v.place(v.spotOf(hit.elements[0])));
      }
    }
    const side = panel.current;
    if (side && !side.contains(document.activeElement)) {
      side
        .querySelector(`[data-item="${CSS.escape(itemKey(item))}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [selection, map]);

  /** A change from a panel or the drawing's own controls. */
  const change = useCallback(
    (next: DiagramModel, options: ChangeOptions = {}) => {
      if ('select' in options) reveal.current = true;
      commit(printDiagram(next), options);
      if (options.edit) setEditing(options.edit);
      if (options.announce) announce(options.announce);
    },
    [commit, announce],
  );

  /** What a key on the drawing does. */
  const apply = (outcome: Outcome) => {
    const selects = 'select' in outcome;
    if (selects) reveal.current = true;
    if (outcome.model)
      commit(printDiagram(outcome.model), selects ? { select: outcome.select } : {});
    else if (selects) pick(outcome.select ?? null);
    if (outcome.edit) setEditing(outcome.edit);
    if (outcome.announce) announce(outcome.announce);
  };

  /** Words edited in place are kept: Tab goes on (one step of the history with them). */
  const commitEdit = (item: Item, text: string, end: EditEnd) => {
    setEditing(null);
    if (!model) return;
    const spec = textOf(model, item);
    let next: DiagramModel = spec && text !== spec.text ? withText(model, item, text) : model;
    const outcome = end === 'tab' ? afterEdit(next, item, map) : null;
    if (outcome?.model) next = outcome.model;
    const after = outcome && 'select' in outcome ? outcome.select : item;
    if (next !== model) {
      reveal.current = true;
      commit(printDiagram(next), { select: after });
    } else pick(after ?? null);
    if (outcome?.edit) setEditing(outcome.edit);
    else if (end !== 'blur') focusCanvas();
    if (outcome?.announce) announce(outcome.announce);
  };
  const cancelEdit = () => {
    setEditing(null);
    focusCanvas();
  };

  const close = () => useShell.getState().closeDialog();
  const finish = () => {
    const now = presentNow.current;
    if (phase === 'edit' && now.trim()) onDone(now);
    close();
  };
  const cancel = () => (dirty ? setConfirming('close') : close());
  const pickTemplate = (template: string) => {
    commit(template, { select: null });
    setPhase('edit');
    setView('visual');
    setEditing(null);
    announce('Template chosen');
  };

  let overlay: ((v: CanvasView) => ReactNode) | undefined;
  let side: ReactNode = null;
  let extend: ((item: Item) => Selection | null) | undefined;
  let onMarquee: ((rect: DOMRect, add: boolean) => void) | undefined;
  if (model) {
    const props = {
      change,
      selection,
      select,
      startEdit: setEditing,
      announce,
    };
    switch (model.type) {
      case 'flowchart': {
        const chart = model;
        side = (
          <FlowchartPanel {...(props as Omit<PanelProps<Flowchart>, 'model'>)} model={chart} />
        );
        extend = (item) => {
          if (item.kind !== 'node') return null;
          const ids = selection?.kind === 'nodes' ? selection.ids : [];
          const next = ids.includes(item.id)
            ? ids.filter((id) => id !== item.id)
            : [...ids, item.id];
          return next.length ? { kind: 'nodes', ids: next } : null;
        };
        onMarquee = (rect, add) => {
          const found = boxesWithin(map, rect);
          const ids =
            add && selection?.kind === 'nodes' ? [...new Set([...selection.ids, ...found])] : found;
          pick(ids.length ? { kind: 'nodes', ids } : null);
          if (found.length)
            announce(`Selected ${ids.length} ${ids.length === 1 ? 'box' : 'boxes'}`);
        };
        overlay = (v) => (
          <FlowchartExtras
            view={v}
            chart={chart}
            map={map}
            selection={selection}
            editing={editing}
            change={change as PanelProps<Flowchart>['change']}
            announce={announce}
          />
        );
        break;
      }
      case 'mindmap':
        side = <MindmapPanel {...(props as Omit<PanelProps<Mindmap>, 'model'>)} model={model} />;
        break;
      case 'sequence':
        side = (
          <SequencePanel {...(props as Omit<PanelProps<SequenceDiagram>, 'model'>)} model={model} />
        );
        break;
      case 'timeline':
        side = <TimelinePanel {...(props as Omit<PanelProps<Timeline>, 'model'>)} model={model} />;
        break;
      case 'gantt':
        side = <GanttPanel {...(props as Omit<PanelProps<Gantt>, 'model'>)} model={model} />;
        break;
      case 'pie':
        side = <PiePanel {...(props as Omit<PanelProps<Pie>, 'model'>)} model={model} />;
        break;
    }
  }

  // Markdown pages can show the code; rich pages only for code the visual editor can't take.
  const codeTab = page === 'markdown' && parsed.ok;
  const notice = !parsed.ok
    ? type === 'other'
      ? `${DIAGRAM_NAMES.other}s of this kind are edited as code; the drawing follows as you type.`
      : `The visual editor can’t take this diagram: ${parsed.reason}${parsed.line ? ` (line ${parsed.line})` : ''}. Edit the code, or start from a template.`
    : null;

  const canvasKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!model) return;
    const mod = e.ctrlKey || e.metaKey;
    // The page's text is never what Ctrl+A selects here.
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyA') e.preventDefault();
    const outcome = keyAction(e, model, selection, map);
    if (!outcome) return;
    e.preventDefault();
    apply(outcome);
  };

  const rootKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (phase !== 'edit' || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    // Words edited in place have their own keys (Enter, Tab, Esc, the field's own undo).
    if (target.closest('.diagram-label-input')) return;
    const inCode = !!target.closest('.cm-editor');
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && !e.altKey && (key === 'z' || key === 'y') && !inCode) {
      e.preventDefault();
      if (key === 'y' || e.shiftKey) redo();
      else undo();
    } else if (mod && !e.altKey && !e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      finish();
    } else if (mod && !e.altKey && ZOOM_KEYS[e.code]) {
      e.preventDefault();
      const zoom = ZOOM_KEYS[e.code];
      if (zoom === 'in') controls.current?.zoomIn();
      else if (zoom === 'out') controls.current?.zoomOut();
      else controls.current?.fit();
    } else if (e.key === '?' && !mod && !isTyping(target) && !inCode) {
      e.preventDefault();
      setKeySheet((open) => !open);
    }
  };

  const title = phase === 'gallery' ? 'New diagram' : DIAGRAM_NAMES[type];
  return (
    <D.Portal>
      <D.Overlay className={overlayClass} />
      <D.Content
        className="diagram-editor"
        aria-describedby={undefined}
        onKeyDown={rootKeys}
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          // Straight to the drawing, ready for the keys.
          const canvas = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
            '.diagram-canvas',
          );
          if (canvas && visual) {
            e.preventDefault();
            canvas.focus({ preventScroll: true });
          }
        }}
        onEscapeKeyDown={(e) => {
          // Esc first leaves what's being done: the key sheet, a field, words being edited,
          // a selection; then asks before throwing changes away.
          if (keySheet) {
            e.preventDefault();
            setKeySheet(false);
            focusCanvas();
            return;
          }
          const active = document.activeElement;
          if (
            active instanceof HTMLElement &&
            active.closest('.diagram-editor-panel, .cm-editor')
          ) {
            e.preventDefault();
            active.blur();
            if (model) focusCanvas();
            return;
          }
          if (editing) {
            e.preventDefault();
            setEditing(null);
            return;
          }
          if (selection) {
            e.preventDefault();
            pick(null);
            announce('Nothing selected');
            return;
          }
          if (confirming) {
            e.preventDefault();
            setConfirming(null);
            return;
          }
          if (dirty) {
            e.preventDefault();
            setConfirming('close');
          }
        }}
      >
        <header className="diagram-editor-bar">
          <Shapes aria-hidden className="diagram-editor-icon" />
          <D.Title className="diagram-editor-title">{title}</D.Title>
          {phase === 'edit' && (
            <div className="diagram-editor-tools">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  dirty && present.trim() ? setConfirming('template') : setPhase('gallery')
                }
              >
                <LayoutTemplate aria-hidden /> <span className="diagram-bar-label">Templates</span>
              </Button>
              <IconButton
                label="Undo"
                icon={<Undo2 />}
                size="sm"
                shortcut={keysLabel('Mod Z')}
                disabled={!history.past.length}
                onClick={undo}
              />
              <IconButton
                label="Redo"
                icon={<Redo2 />}
                size="sm"
                shortcut={keysLabel('Mod Shift Z')}
                disabled={!history.future.length}
                onClick={redo}
              />
              <IconButton
                label="Keys"
                icon={<Keyboard />}
                size="sm"
                shortcut="?"
                active={keySheet}
                onClick={() => setKeySheet((open) => !open)}
              />
              {codeTab && (
                <SegmentedControl
                  label="Show"
                  value={view}
                  onValueChange={(next) => {
                    setEditing(null);
                    setView(next);
                  }}
                  segments={[
                    { value: 'visual', label: 'Visual', icon: <Shapes /> },
                    { value: 'code', label: 'Code', icon: <Code2 /> },
                  ]}
                />
              )}
            </div>
          )}
          <div className="flex-1" />
          {confirming ? (
            <div className="diagram-confirm" role="alert">
              <span>
                {confirming === 'close'
                  ? 'Throw away your changes to the diagram?'
                  : 'Start again from a template? Your changes go.'}
              </span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  if (confirming === 'close') close();
                  else {
                    setConfirming(null);
                    setPhase('gallery');
                  }
                }}
              >
                {confirming === 'close' ? 'Throw away' : 'Start again'}
              </Button>
              <Button size="sm" onClick={() => setConfirming(null)} autoFocus>
                Keep editing
              </Button>
            </div>
          ) : (
            <div className="diagram-editor-tools">
              <Button
                variant="ghost"
                size="sm"
                onClick={phase === 'gallery' && code !== null ? () => setPhase('edit') : cancel}
              >
                {phase === 'gallery' && code !== null ? 'Back' : 'Cancel'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                title={keysLabel('Mod Enter')}
                onClick={finish}
                disabled={phase === 'gallery' || !present.trim()}
              >
                Done
              </Button>
            </div>
          )}
        </header>

        <EditEpoch value={history.epoch}>
          {phase === 'gallery' ? (
            <div className="diagram-editor-scroll">
              <Gallery onPick={pickTemplate} />
            </div>
          ) : model ? (
            <div className="diagram-editor-body">
              <div className="diagram-editor-main">
                <Canvas
                  code={present}
                  label={`${title}: the drawing`}
                  description="Arrow keys select, Enter adds, F2 or typing edits the words, Delete removes; press ? for every key."
                  controls={controls}
                  onDrawn={onDrawn}
                  isItem={(element) => !!map.itemAt(element)}
                  onMarquee={onMarquee}
                  overlay={(v) => {
                    canvasView.current = v;
                    return (
                      <EditorOverlay
                        view={v}
                        model={model}
                        map={map}
                        selection={selection}
                        select={pick}
                        extend={extend}
                        editing={editing}
                        startEdit={setEditing}
                        commit={commitEdit}
                        cancel={cancelEdit}
                      >
                        {overlay?.(v)}
                      </EditorOverlay>
                    );
                  }}
                  onBackgroundClick={() => {
                    if (selection) pick(null);
                  }}
                  onKeyDown={canvasKeys}
                />
                {keySheet && (
                  <KeySheet
                    type={type}
                    onClose={() => {
                      setKeySheet(false);
                      focusCanvas();
                    }}
                  />
                )}
              </div>
              <aside ref={panel} className="diagram-editor-panel" aria-label="Diagram details">
                {side}
              </aside>
            </div>
          ) : (
            <div className="diagram-editor-body is-code">
              <div className="diagram-editor-code">
                {notice && <p className="diagram-notice">{notice}</p>}
                <CodePane
                  code={present}
                  onChange={(next) => commit(next, { merge: 'code' })}
                  onUndo={undo}
                  onRedo={redo}
                  label="Mermaid code"
                />
              </div>
              <div className="diagram-editor-main">
                <Canvas code={present} label={`${title}: the drawing`} controls={controls} />
                {keySheet && <KeySheet type={type} onClose={() => setKeySheet(false)} />}
              </div>
            </div>
          )}
        </EditEpoch>
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </D.Content>
    </D.Portal>
  );
}
