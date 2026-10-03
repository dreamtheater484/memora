import { MINDMAP_SHAPES, mindmapTopics, type Mindmap, type MindmapShape } from '@memora/shared';
import {
  ArrowDown,
  ArrowUp,
  IndentDecrease,
  IndentIncrease,
  ListTree,
  Plus,
  Trash2,
} from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { IconButton, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import { keysLabel } from '../../shell/shortcuts';
import { TextField } from './fields';
import { withText } from './labels';
import {
  addChildTopic,
  addSiblingTopic,
  indentTopic,
  insertParentTopic,
  moveTopic,
  moveTopicToEnd,
  outdentTopic,
  removeTopic,
  removeTopicKeepChildren,
  updateTopic,
} from './ops';
import { Section, type PanelProps } from './panel';
import { focusField } from './rows';
import { itemKey } from './selection';

/*
 * Editing a mind map (§9.4): on the drawing, a topic is selected with a click and edited in
 * place (double-click, F2, or just type); Enter adds a topic after it, Tab one under it. The
 * outline beside the drawing is the same map as a list, the way to edit it on a phone or with
 * a screen reader: Enter adds a topic, Insert one under it, Tab and Shift+Tab change its
 * level, Alt+↑ and Alt+↓ move it, Shift+Enter breaks a line, Backspace in an empty topic
 * removes it (what was under it stays).
 */

const SHAPE_NAMES: Record<MindmapShape, string> = {
  default: 'Plain',
  rounded: 'Rounded',
  square: 'Square',
  circle: 'Circle',
  cloud: 'Cloud',
  bang: 'Bang',
  hexagon: 'Hexagon',
};

const topicField = (index: number) => `[data-item="topic:${index}"] textarea`;

export function MindmapPanel({
  model: map,
  change,
  selection,
  select,
  announce,
}: PanelProps<Mindmap>) {
  const topics = mindmapTopics(map);
  const selected = selection?.kind === 'topic' ? selection.index : null;
  const current = selected !== null ? topics[selected] : undefined;

  /** A change that moves the selection, and the focus with it when it is in the outline. */
  const go = (result: { map: Mindmap; index: number }, message?: string, focus = true) => {
    if (result.map === map) return;
    change(result.map, { select: { kind: 'topic', index: result.index }, announce: message });
    if (focus) focusField(topicField(result.index));
  };

  const rowKeys = (index: number, label: string) => (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.ctrlKey || e.metaKey;
    const field = e.currentTarget;
    const firstLine = !field.value.slice(0, field.selectionStart).includes('\n');
    const lastLine = !field.value.slice(field.selectionEnd).includes('\n');
    if (e.key === 'Enter' && mod && e.shiftKey) {
      e.preventDefault();
      go(insertParentTopic(map, index), 'Added a topic above it');
    } else if (e.key === 'Enter' && !e.shiftKey && !mod && !e.altKey) {
      e.preventDefault();
      go(addSiblingTopic(map, index), 'Added a topic');
    } else if (e.key === 'Insert' && !mod) {
      e.preventDefault();
      go(addChildTopic(map, index), 'Added a topic under it');
    } else if (e.key === 'Tab' && !mod && !e.altKey && index > 0) {
      e.preventDefault();
      go(
        e.shiftKey ? outdentTopic(map, index) : indentTopic(map, index),
        e.shiftKey ? 'Moved out a level' : 'Moved in a level',
      );
    } else if (e.altKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      go(
        e.shiftKey
          ? moveTopicToEnd(map, index, e.key === 'ArrowUp' ? 'first' : 'last')
          : moveTopic(map, index, e.key === 'ArrowUp' ? -1 : 1),
      );
    } else if (
      e.altKey &&
      e.shiftKey &&
      !mod &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      e.preventDefault();
      go(e.key === 'ArrowRight' ? indentTopic(map, index) : outdentTopic(map, index));
    } else if (e.key === 'ArrowUp' && !e.altKey && !mod && firstLine && index > 0) {
      e.preventDefault();
      focusField(topicField(index - 1));
    } else if (
      e.key === 'ArrowDown' &&
      !e.altKey &&
      !mod &&
      lastLine &&
      index < topics.length - 1
    ) {
      e.preventDefault();
      focusField(topicField(index + 1));
    } else if (e.key === 'Backspace' && label === '' && field.value === '' && index > 0) {
      e.preventDefault();
      change(removeTopicKeepChildren(map, index), {
        select: { kind: 'topic', index: index - 1 },
        announce: 'Removed the topic',
      });
      focusField(topicField(index - 1));
    }
  };

  return (
    <div className="diagram-panel">
      <Section title="Topics">
        <ul className="diagram-mind-outline" aria-label="Topics">
          {topics.map(({ topic, depth }, index) => (
            <li
              key={index}
              data-item={itemKey({ kind: 'topic', index })}
              style={{ paddingLeft: `${depth * 1.1}rem` }}
            >
              <span aria-hidden className={cn('diagram-bullet', depth === 0 && 'is-root')} />
              <TextField
                variant="plain"
                multiline
                aria-label={depth === 0 ? 'Central topic' : `Topic, level ${depth}`}
                className={cn('diagram-mind-input', selected === index && 'is-on')}
                value={topic.label}
                onFocus={() => selected !== index && select({ kind: 'topic', index })}
                onValueChange={(label) =>
                  change(withText(map, { kind: 'topic', index }, label), {
                    merge: `topic:${index}`,
                  })
                }
                onKeyDown={rowKeys(index, topic.label)}
              />
            </li>
          ))}
        </ul>
        {current && selected !== null && (
          <div className="diagram-toolbar" role="toolbar" aria-label="Topic">
            <IconButton
              label="Add a topic under it"
              shortcut={keysLabel('Tab')}
              icon={<Plus />}
              size="sm"
              onClick={() => go(addChildTopic(map, selected), 'Added a topic under it')}
            />
            <IconButton
              label="Add a topic above it"
              shortcut={keysLabel('Mod Shift Enter')}
              icon={<ListTree />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(insertParentTopic(map, selected), 'Added a topic above it')}
            />
            <IconButton
              label="Move in a level"
              shortcut={keysLabel('Alt Shift →')}
              icon={<IndentIncrease />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(indentTopic(map, selected), 'Moved in a level')}
            />
            <IconButton
              label="Move out a level"
              shortcut={keysLabel('Alt Shift ←')}
              icon={<IndentDecrease />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(outdentTopic(map, selected), 'Moved out a level')}
            />
            <IconButton
              label="Move up"
              shortcut={keysLabel('Alt ↑')}
              icon={<ArrowUp />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(moveTopic(map, selected, -1))}
            />
            <IconButton
              label="Move down"
              shortcut={keysLabel('Alt ↓')}
              icon={<ArrowDown />}
              size="sm"
              disabled={selected === 0}
              onClick={() => go(moveTopic(map, selected, 1))}
            />
            <IconButton
              label="Delete the topic and what is under it"
              shortcut={keysLabel('Delete')}
              icon={<Trash2 />}
              size="sm"
              disabled={selected === 0}
              onClick={() => {
                change(removeTopic(map, selected), {
                  select: { kind: 'topic', index: Math.max(0, selected - 1) },
                });
                announce('Removed the topic and what was under it');
              }}
            />
          </div>
        )}
      </Section>
      {current && selected !== null && (
        <Section title="Shape">
          <Select
            aria-label="Shape of the topic"
            value={current.topic.shape}
            options={MINDMAP_SHAPES.map((s, i) => ({
              value: s,
              label: `${SHAPE_NAMES[s]}  ·  ${keysLabel(`Mod ${i + 1}`)}`,
            }))}
            onValueChange={(shape) =>
              change(updateTopic(map, selected, { shape: shape as MindmapShape }))
            }
          />
        </Section>
      )}
      <p className="diagram-hint">
        On the drawing: Enter adds a topic, Tab one under it, F2 or typing edits it. In the outline:
        Enter adds a topic, Tab and Shift+Tab change its level, Alt+↑ and Alt+↓ move it. Press ? for
        every key.
      </p>
    </div>
  );
}
