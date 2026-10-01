import { MINDMAP_SHAPES, mindmapTopics, type Mindmap, type MindmapShape } from '@memora/shared';
import { ArrowDown, ArrowUp, IndentDecrease, IndentIncrease, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { IconButton, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { CanvasView } from './Canvas';
import { Section } from './flowchart';
import {
  NEW_TOPIC,
  addChildTopic,
  addSiblingTopic,
  indentTopic,
  moveTopic,
  outdentTopic,
  removeTopic,
  updateTopic,
} from './ops';

/*
 * Editing a mind map (§9.4): an outline beside the drawing. Enter adds a topic at the same
 * level, Tab and Shift+Tab change a topic's level, Alt+↑ and Alt+↓ move it, Backspace on an
 * empty topic removes it. Clicking a topic in the drawing goes to its line.
 */

export interface MindEditorProps {
  map: Mindmap;
  change: (next: Mindmap, merge?: string) => void;
  /** The selected topic, numbered depth first (the centre is 0). */
  selected: number | null;
  select: (index: number | null) => void;
  announce: (message: string) => void;
}

const SHAPE_NAMES: Record<MindmapShape, string> = {
  default: 'Plain',
  rounded: 'Rounded',
  square: 'Square',
  circle: 'Circle',
  cloud: 'Cloud',
  bang: 'Bang',
  hexagon: 'Hexagon',
};

/** The topic a drawn element belongs to: Mermaid numbers them node_0, node_1… */
function topicOf(element: Element | null): number | null {
  const node = element?.closest('g.mindmap-node, g.node');
  const match = node?.id ? /-node_(\d+)$/.exec(node.id) : null;
  return match ? Number(match[1]) : null;
}

export function MindmapOverlay({
  view,
  selected,
  select,
}: Pick<MindEditorProps, 'selected' | 'select'> & { view: CanvasView }) {
  const { svg, spotOf, place } = view;
  useEffect(() => {
    if (!svg) return;
    const click = (e: MouseEvent) => {
      const index = topicOf(e.target as Element);
      if (index !== null) select(index);
    };
    svg.addEventListener('click', click);
    return () => svg.removeEventListener('click', click);
  }, [svg, select]);
  const spot = useMemo(() => {
    if (!svg || selected === null) return null;
    const node = svg.querySelector(`[id$="-node_${selected}"]`);
    return node ? spotOf(node) : null;
  }, [svg, selected, spotOf]);
  const rect = spot ? place(spot) : null;
  return (
    <div className="diagram-overlay" aria-hidden>
      {rect && (
        <div
          className="diagram-ring"
          style={{
            left: rect.x - 5,
            top: rect.y - 5,
            width: rect.width + 10,
            height: rect.height + 10,
          }}
        />
      )}
    </div>
  );
}

export function MindmapPanel({ map, change, selected, select, announce }: MindEditorProps) {
  const topics = mindmapTopics(map);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  // Focus follows the selection, once the outline has been drawn again.
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    if (focusNext.current === null) return;
    const input = inputs.current[focusNext.current];
    focusNext.current = null;
    input?.focus();
    // A new topic's placeholder words are replaced by what is typed.
    if (input?.value === NEW_TOPIC) input.select();
  });
  // A topic clicked in the drawing: its line, ready to type.
  useEffect(() => {
    const input = selected !== null ? inputs.current[selected] : null;
    if (
      input &&
      document.activeElement !== input &&
      !document.activeElement?.closest('.diagram-editor-panel')
    ) {
      input.focus();
    }
  }, [selected]);

  const go = (result: { map: Mindmap; index: number }, message?: string) => {
    change(result.map);
    select(result.index);
    focusNext.current = result.index;
    if (message) announce(message);
  };
  const current = selected !== null ? topics[selected] : undefined;

  return (
    <div className="diagram-panel">
      <Section title="Topics">
        <ul className="diagram-mind-outline" aria-label="Topics">
          {topics.map(({ topic, depth }, index) => (
            <li key={index} style={{ paddingLeft: `${depth * 1.1}rem` }}>
              <span aria-hidden className={cn('diagram-bullet', depth === 0 && 'is-root')} />
              <input
                ref={(el) => {
                  inputs.current[index] = el;
                }}
                aria-label={depth === 0 ? 'Central topic' : `Topic, level ${depth}`}
                className={cn('diagram-mind-input', selected === index && 'is-on')}
                value={topic.label}
                onFocus={() => select(index)}
                onChange={(e) =>
                  change(updateTopic(map, index, { label: e.target.value }), `topic:${index}`)
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    go(addSiblingTopic(map, index), 'Added a topic');
                  } else if (e.key === 'Tab' && !e.shiftKey && index > 0) {
                    e.preventDefault();
                    go(indentTopic(map, index), 'Moved in a level');
                  } else if (e.key === 'Tab' && e.shiftKey && index > 0) {
                    e.preventDefault();
                    go(outdentTopic(map, index), 'Moved out a level');
                  } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    go(moveTopic(map, index, e.key === 'ArrowUp' ? -1 : 1));
                  } else if (e.key === 'ArrowUp' && index > 0) {
                    e.preventDefault();
                    inputs.current[index - 1]?.focus();
                  } else if (e.key === 'ArrowDown' && index < topics.length - 1) {
                    e.preventDefault();
                    inputs.current[index + 1]?.focus();
                  } else if (e.key === 'Backspace' && topic.label === '' && index > 0) {
                    e.preventDefault();
                    change(removeTopic(map, index));
                    select(index - 1);
                    focusNext.current = index - 1;
                    announce('Removed the topic');
                  }
                }}
              />
            </li>
          ))}
        </ul>
        {current && (
          <div className="diagram-toolbar" role="toolbar" aria-label="Topic">
            <IconButton
              label="Add a topic under it"
              icon={<Plus />}
              size="sm"
              onClick={() => go(addChildTopic(map, selected!), 'Added a topic under it')}
            />
            <IconButton
              label="Move in a level (Tab)"
              icon={<IndentIncrease />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(indentTopic(map, selected!))}
            />
            <IconButton
              label="Move out a level (Shift+Tab)"
              icon={<IndentDecrease />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(outdentTopic(map, selected!))}
            />
            <IconButton
              label="Move up (Alt+↑)"
              icon={<ArrowUp />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(moveTopic(map, selected!, -1))}
            />
            <IconButton
              label="Move down (Alt+↓)"
              icon={<ArrowDown />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(moveTopic(map, selected!, 1))}
            />
            <IconButton
              label="Delete the topic"
              icon={<Trash2 />}
              size="sm"
              disabled={selected === 0}
              onClick={() => {
                change(removeTopic(map, selected!));
                select(Math.max(0, selected! - 1));
                announce('Removed the topic and what was under it');
              }}
            />
          </div>
        )}
      </Section>
      {current && (
        <Section title="Shape">
          <Select
            aria-label="Shape of the topic"
            value={current.topic.shape}
            options={MINDMAP_SHAPES.map((s) => ({ value: s, label: SHAPE_NAMES[s] }))}
            onValueChange={(shape) =>
              change(updateTopic(map, selected!, { shape: shape as MindmapShape }))
            }
          />
        </Section>
      )}
      <p className="diagram-hint">
        Enter adds a topic, Tab and Shift+Tab change its level, Alt+↑ and Alt+↓ move it.
      </p>
    </div>
  );
}
