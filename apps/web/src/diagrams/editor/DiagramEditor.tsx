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
import { Code2, LayoutTemplate, Redo2, Shapes, Undo2 } from 'lucide-react';
import { Dialog as D } from 'radix-ui';
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, IconButton, SegmentedControl } from '../../components/ui';
import { overlayClass } from '../../components/ui/Dialog';
import { keysLabel } from '../../shell/shortcuts';
import { useShell } from '../../shell/store';
import { Canvas, type CanvasView } from './Canvas';
import { GanttPanel, PiePanel, TimelinePanel } from './charts';
import { CodePane } from './CodePane';
import { FlowchartOverlay, FlowchartPanel } from './flowchart';
import {
  flowchartKeys,
  nodeCentres,
  type FlowEditorProps,
  type FlowSelection,
} from './flowchartDom';
import { Gallery } from './Gallery';
import { MindmapOverlay, MindmapPanel } from './mindmap';
import { SequenceOverlay, SequencePanel, type SeqSelection } from './sequence';
import './editor.css';

/*
 * The diagram editor (§9.3, §9.4): full screen, the diagram in the middle and its details
 * beside it (below it on a phone). Flowcharts, mind maps, sequence diagrams, timelines,
 * Gantt charts and pie charts are edited visually; other diagrams, and any code the visual
 * editor can't take, as Mermaid code with a live drawing. Markdown pages can switch to the
 * code too. Its own undo; Done puts the result in the page as one change.
 */

interface Props {
  code: string | null;
  page: 'markdown' | 'rich';
  onDone: (code: string) => void;
}

interface History {
  past: string[];
  present: string;
  future: string[];
  /** What the last change was (typing in one field is one step), and when. */
  merge: string | null;
  at: number;
}

const HISTORY = 200;

const isTyping = (target: EventTarget | null) =>
  !!(target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');

export default function DiagramEditorDialog({ code, page, onDone }: Props) {
  const initial = code ?? '';
  const [history, setHistory] = useState<History>({
    past: [],
    present: initial,
    future: [],
    merge: null,
    at: 0,
  });
  const [phase, setPhase] = useState<'gallery' | 'edit'>(code === null ? 'gallery' : 'edit');
  const [view, setView] = useState<'visual' | 'code'>('visual');
  const [confirming, setConfirming] = useState<'close' | 'template' | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const present = history.present;
  const parsed = useMemo(() => parseDiagram(present), [present]);
  const type = detectDiagram(present) ?? 'other';
  const dirty = present !== initial;
  const visual = parsed.ok && view === 'visual';

  const setCode = useCallback((next: string, merge?: string) => {
    setHistory((h) => {
      if (next === h.present) return h;
      const now = Date.now();
      if (merge && merge === h.merge && now - h.at < 1500) {
        return { ...h, present: next, future: [], at: now };
      }
      return {
        past: [...h.past, h.present].slice(-HISTORY),
        present: next,
        future: [],
        merge: merge ?? null,
        at: now,
      };
    });
  }, []);
  const change = useCallback(
    (model: DiagramModel, merge?: string) => setCode(printDiagram(model), merge),
    [setCode],
  );
  const undo = () =>
    setHistory((h) =>
      h.past.length
        ? {
            past: h.past.slice(0, -1),
            present: h.past.at(-1)!,
            future: [h.present, ...h.future],
            merge: null,
            at: 0,
          }
        : h,
    );
  const redo = () =>
    setHistory((h) =>
      h.future.length
        ? {
            past: [...h.past, h.present],
            present: h.future[0]!,
            future: h.future.slice(1),
            merge: null,
            at: 0,
          }
        : h,
    );

  // What is selected, per kind of diagram.
  const [flowSelection, setFlowSelection] = useState<FlowSelection>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [mindSelected, setMindSelected] = useState<number | null>(0);
  const [seqSelection, setSeqSelection] = useState<SeqSelection>(null);
  const canvas = useRef<CanvasView | null>(null);

  const close = () => useShell.getState().closeDialog();
  const finish = () => {
    if (phase === 'edit' && present.trim()) onDone(present);
    close();
  };
  const cancel = () => (dirty ? setConfirming('close') : close());
  const pick = (template: string) => {
    setCode(template);
    setPhase('edit');
    setView('visual');
    setFlowSelection(null);
    setEditing(null);
    setMindSelected(0);
    setSeqSelection(null);
    announce('Template chosen');
  };

  const flowProps = (chart: Flowchart): FlowEditorProps => ({
    chart,
    change: (next, merge) => change(next, merge),
    selection: flowSelection,
    select: setFlowSelection,
    editing,
    setEditing,
    announce,
  });

  let overlay: ((v: CanvasView) => ReactNode) | undefined;
  let panel: ReactNode = null;
  let canvasKeys: ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  let clear: (() => void) | undefined;
  if (visual && parsed.ok) {
    const model = parsed.model;
    switch (model.type) {
      case 'flowchart': {
        const props = flowProps(model);
        overlay = (v) => <FlowchartOverlay view={v} {...props} />;
        panel = <FlowchartPanel {...props} />;
        canvasKeys = (e) => {
          if (flowchartKeys(e, props, () => nodeCentres(canvas.current?.svg ?? null))) {
            e.preventDefault();
          }
        };
        clear = () => setFlowSelection(null);
        break;
      }
      case 'mindmap': {
        const props = {
          map: model as Mindmap,
          change: (next: Mindmap, merge?: string) => change(next, merge),
          selected: mindSelected,
          select: setMindSelected,
          announce,
        };
        overlay = (v) => (
          <MindmapOverlay view={v} selected={mindSelected} select={setMindSelected} />
        );
        panel = <MindmapPanel {...props} />;
        canvasKeys = (e) => {
          if ((e.key === 'Enter' || e.key === 'F2') && mindSelected !== null) {
            e.preventDefault();
            document
              .querySelectorAll<HTMLInputElement>('.diagram-mind-input')
              [mindSelected]?.focus();
          }
        };
        break;
      }
      case 'sequence': {
        const props = {
          diagram: model as SequenceDiagram,
          change: (next: SequenceDiagram, merge?: string) => change(next, merge),
          selection: seqSelection,
          select: setSeqSelection,
          announce,
        };
        overlay = (v) => (
          <SequenceOverlay
            view={v}
            diagram={props.diagram}
            selection={seqSelection}
            select={setSeqSelection}
          />
        );
        panel = <SequencePanel {...props} />;
        clear = () => setSeqSelection(null);
        break;
      }
      case 'timeline':
        panel = <TimelinePanel model={model as Timeline} change={(n, m) => change(n, m)} />;
        break;
      case 'gantt':
        panel = <GanttPanel model={model as Gantt} change={(n, m) => change(n, m)} />;
        break;
      case 'pie':
        panel = <PiePanel model={model as Pie} change={(n, m) => change(n, m)} />;
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

  const rootKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (phase !== 'edit' || isTyping(e.target) || (e.target as HTMLElement).closest('.cm-editor'))
      return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
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
        onEscapeKeyDown={(e) => {
          // Esc first leaves what's being done: renaming, a selection; then asks before
          // throwing changes away.
          const active = document.activeElement;
          if (active?.closest('.diagram-label-input, .diagram-editor-panel input, .cm-editor')) {
            e.preventDefault();
            if (active instanceof HTMLElement) active.blur();
            return;
          }
          if (editing) {
            e.preventDefault();
            setEditing(null);
            return;
          }
          if (flowSelection || seqSelection) {
            e.preventDefault();
            setFlowSelection(null);
            setSeqSelection(null);
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
                <LayoutTemplate aria-hidden /> Templates
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
              {codeTab && (
                <SegmentedControl
                  label="Show"
                  value={view}
                  onValueChange={setView}
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
                onClick={finish}
                disabled={phase === 'gallery' || !present.trim()}
              >
                Done
              </Button>
            </div>
          )}
        </header>

        {phase === 'gallery' ? (
          <div className="diagram-editor-scroll">
            <Gallery onPick={pick} />
          </div>
        ) : visual ? (
          <div className="diagram-editor-body">
            <div className="diagram-editor-main">
              <Canvas
                code={present}
                label={`${title}: the drawing`}
                overlay={(v) => {
                  canvas.current = v;
                  return overlay?.(v);
                }}
                onBackgroundClick={clear}
                onKeyDown={canvasKeys}
              />
            </div>
            <aside className="diagram-editor-panel" aria-label="Diagram details">
              {panel}
            </aside>
          </div>
        ) : (
          <div className="diagram-editor-body is-code">
            <div className="diagram-editor-code">
              {notice && <p className="diagram-notice">{notice}</p>}
              <CodePane
                code={present}
                onChange={(next) => setCode(next, 'code')}
                label="Mermaid code"
              />
            </div>
            <div className="diagram-editor-main">
              <Canvas code={present} label={`${title}: the drawing`} />
            </div>
          </div>
        )}
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </D.Content>
    </D.Portal>
  );
}
