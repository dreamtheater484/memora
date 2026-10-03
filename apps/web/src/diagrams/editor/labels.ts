import { mindmapTopics, type DiagramModel } from '@memora/shared';
import { stepAt } from './ops';
import type { Item } from './selection';

/*
 * The words of each item in a diagram (§9.4), read and written the same way wherever they
 * are edited: in place on the drawing or in the panel.
 */

export interface TextSpec {
  text: string;
  /** Lines break with Shift+Enter (written as `<br>` in the code). */
  multiline: boolean;
  /** A number (a pie slice's value). */
  numeric?: boolean;
  /** What the field is called, for screen readers. */
  label: string;
}

const spec = (text: string, label: string, multiline = false): TextSpec => ({
  text,
  multiline,
  label,
});

/** The words of an item, or null when it has none to edit. */
export function textOf(model: DiagramModel, item: Item): TextSpec | null {
  switch (model.type) {
    case 'flowchart': {
      if (item.kind === 'node') {
        const node = model.nodes.find((n) => n.id === item.id);
        return node ? spec(node.label, 'Box label', true) : null;
      }
      if (item.kind === 'edge') {
        const edge = model.edges[item.index];
        return edge ? spec(edge.label, 'Arrow label', true) : null;
      }
      if (item.kind === 'group') {
        const group = model.groups.find((g) => g.id === item.id);
        return group ? spec(group.label, 'Group name') : null;
      }
      return null;
    }
    case 'mindmap': {
      if (item.kind !== 'topic') return null;
      const topic = mindmapTopics(model)[item.index];
      return topic ? spec(topic.topic.label, 'Topic', true) : null;
    }
    case 'sequence': {
      if (item.kind === 'title') return spec(model.title ?? '', 'Title');
      if (item.kind === 'participant') {
        const p = model.participants.find((x) => x.id === item.id);
        return p ? spec(p.label, 'Participant’s name', true) : null;
      }
      if (item.kind === 'step') {
        const step = stepAt(model, item.path);
        if (step?.kind === 'message') return spec(step.text, 'Message', true);
        if (step?.kind === 'note') return spec(step.text, 'Note', true);
        if (step?.kind === 'block') return spec(step.branches[0]!.text, 'Condition');
        return null;
      }
      if (item.kind === 'branch') {
        const step = stepAt(model, item.path);
        const branch = step?.kind === 'block' ? step.branches[item.branch] : undefined;
        return branch ? spec(branch.text, 'Condition') : null;
      }
      return null;
    }
    case 'timeline': {
      if (item.kind === 'title') return spec(model.title, 'Title');
      if (item.kind === 'section') {
        const s = model.sections[item.section];
        return s && s.label !== null ? spec(s.label, 'Section name') : null;
      }
      if (item.kind === 'period') {
        const p = model.sections[item.section]?.periods[item.period];
        return p ? spec(p.label, 'Period', true) : null;
      }
      if (item.kind === 'event') {
        const e = model.sections[item.section]?.periods[item.period]?.events[item.event];
        return e !== undefined ? spec(e, 'Event', true) : null;
      }
      return null;
    }
    case 'gantt': {
      if (item.kind === 'title') return spec(model.title, 'Title');
      if (item.kind === 'section') {
        const s = model.sections[item.section];
        return s && s.label !== null ? spec(s.label, 'Section name') : null;
      }
      if (item.kind === 'task') {
        const t = model.sections[item.section]?.tasks[item.task];
        return t ? spec(t.name, 'Task') : null;
      }
      return null;
    }
    case 'pie': {
      if (item.kind === 'title') return spec(model.title, 'Title');
      if (item.kind === 'slice') {
        const s = model.slices[item.index];
        return s ? spec(s.label, 'Slice') : null;
      }
      if (item.kind === 'value') {
        const s = model.slices[item.index];
        return s ? { ...spec(String(s.value), 'Value'), numeric: true } : null;
      }
      return null;
    }
  }
}

/** The model with an item's words changed. */
export function withText<M extends DiagramModel>(model: M, item: Item, text: string): M {
  const next = structuredClone(model) as DiagramModel;
  switch (next.type) {
    case 'flowchart':
      if (item.kind === 'node') {
        const node = next.nodes.find((n) => n.id === item.id);
        if (node) node.label = text;
      } else if (item.kind === 'edge') {
        const edge = next.edges[item.index];
        if (edge) edge.label = text;
      } else if (item.kind === 'group') {
        const group = next.groups.find((g) => g.id === item.id);
        if (group) group.label = text;
      }
      break;
    case 'mindmap':
      if (item.kind === 'topic') {
        const topic = mindmapTopics(next)[item.index]?.topic;
        if (topic) topic.label = text;
      }
      break;
    case 'sequence':
      if (item.kind === 'title') next.title = text || null;
      else if (item.kind === 'participant') {
        const p = next.participants.find((x) => x.id === item.id);
        if (p) p.label = text;
      } else if (item.kind === 'step') {
        const step = stepAt(next, item.path);
        if (step?.kind === 'message' || step?.kind === 'note') step.text = text;
        else if (step?.kind === 'block') step.branches[0]!.text = text;
      } else if (item.kind === 'branch') {
        const step = stepAt(next, item.path);
        const branch = step?.kind === 'block' ? step.branches[item.branch] : undefined;
        if (branch) branch.text = text;
      }
      break;
    case 'timeline':
      if (item.kind === 'title') next.title = text;
      else if (item.kind === 'section') {
        const s = next.sections[item.section];
        if (s && s.label !== null) s.label = text;
      } else if (item.kind === 'period') {
        const p = next.sections[item.section]?.periods[item.period];
        if (p) p.label = text;
      } else if (item.kind === 'event') {
        const p = next.sections[item.section]?.periods[item.period];
        if (p && item.event < p.events.length) p.events[item.event] = text;
      }
      break;
    case 'gantt':
      if (item.kind === 'title') next.title = text;
      else if (item.kind === 'section') {
        const s = next.sections[item.section];
        if (s && s.label !== null) s.label = text;
      } else if (item.kind === 'task') {
        const t = next.sections[item.section]?.tasks[item.task];
        if (t) t.name = text;
      }
      break;
    case 'pie':
      if (item.kind === 'title') next.title = text;
      else if (item.kind === 'slice') {
        const s = next.slices[item.index];
        if (s) s.label = text;
      } else if (item.kind === 'value') {
        const s = next.slices[item.index];
        const value = Number(text.replace(',', '.'));
        if (s && Number.isFinite(value) && value >= 0) s.value = value;
      }
      break;
  }
  return next as M;
}
