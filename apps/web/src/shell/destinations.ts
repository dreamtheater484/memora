import type { ColorId } from '@memora/shared';
import type { NotesIndex } from '../notes/model';

/** Somewhere to move (or restore) things to, in reading order. */
export interface Destination {
  id: string;
  kind: 'notebook' | 'group' | 'section';
  label: string;
  path: string;
  color: ColorId;
  notebookId: string | null;
  groupId: string | null;
}

export function destinations(
  index: NotesIndex,
  type: 'pages' | 'section' | 'group',
): Destination[] {
  const out: Destination[] = [];
  if (type === 'pages') {
    out.push({
      id: index.inbox.id,
      kind: 'section',
      label: 'Inbox',
      path: '',
      color: index.inbox.color,
      notebookId: null,
      groupId: null,
    });
  }
  for (const nb of index.notebooks) {
    if (type !== 'pages') {
      out.push({
        id: nb.id,
        kind: 'notebook',
        label: nb.name,
        path: '',
        color: nb.color,
        notebookId: nb.id,
        groupId: null,
      });
    }
    const walk = (groupId: string | null, trail: string[]) => {
      if (type === 'pages') {
        for (const s of index.sectionsIn(nb.id, groupId)) {
          out.push({
            id: s.id,
            kind: 'section',
            label: s.name,
            path: trail.join(' › '),
            color: s.color,
            notebookId: nb.id,
            groupId,
          });
        }
      }
      for (const g of index.groupsIn(nb.id, groupId)) {
        if (type !== 'pages') {
          out.push({
            id: g.id,
            kind: 'group',
            label: g.name,
            path: trail.join(' › '),
            color: nb.color,
            notebookId: nb.id,
            groupId: g.id,
          });
        }
        walk(g.id, [...trail, g.name]);
      }
    };
    walk(null, [nb.name]);
  }
  return out;
}
