import { useEffect } from 'react';
import { setDropRules, type DragItem, type DropSpot, type DropTarget, type Zone } from '../lib/dnd';
import {
  checkGroupMove,
  checkPagePlace,
  type GroupPlace,
  type NotesIndex,
  type PagePlace,
  type SectionPlace,
} from '../notes/model';
import { useNotes, useNotesActions } from '../notes/queries';
import type { Commands } from './commands';

/*
 * What can be dropped where. Drop spots, by `data-drop-kind`:
 * nb / grp / sec  rows in the navigation (notebook, section group, section)
 * tab / gtab      section tabs and section group tabs
 * page            a row in the page list
 * pages-end       the empty space below the page list
 */

const ZONES: readonly Zone[] = ['before', 'after', 'inside'];

/** The next sibling after `id`, skipping the items being moved. */
function after<T extends { id: string }>(
  siblings: readonly T[],
  id: string,
  moving: readonly string[],
) {
  const rest = siblings.filter((s) => s.id === id || !moving.includes(s.id));
  return rest[rest.findIndex((s) => s.id === id) + 1]?.id ?? null;
}

function pagePlace(index: NotesIndex, item: DragItem, target: DropTarget): PagePlace | null {
  if (target.kind === 'pages-end')
    return { sectionId: target.id, parentPageId: null, beforeId: null };
  if (target.kind === 'tab' || target.kind === 'sec') {
    return { sectionId: target.id, parentPageId: null, beforeId: null };
  }
  if (target.kind !== 'page') return null;
  const page = index.page.get(target.id);
  if (!page) return null;
  if (target.zone === 'inside')
    return { sectionId: page.sectionId, parentPageId: page.id, beforeId: null };
  if (target.zone === 'before') {
    return { sectionId: page.sectionId, parentPageId: page.parentPageId, beforeId: page.id };
  }
  const siblings = index
    .pagesOf(page.sectionId)
    .map((r) => r.page)
    .filter((p) => p.parentPageId === page.parentPageId);
  return {
    sectionId: page.sectionId,
    parentPageId: page.parentPageId,
    beforeId: after(siblings, page.id, item.ids),
  };
}

function sectionPlace(index: NotesIndex, item: DragItem, target: DropTarget): SectionPlace | null {
  if (target.kind === 'nb') return { notebookId: target.id, groupId: null, beforeId: null };
  if (target.kind === 'grp' || target.kind === 'gtab') {
    const group = index.group.get(target.id);
    return group ? { notebookId: group.notebookId, groupId: group.id, beforeId: null } : null;
  }
  const section = index.section.get(target.id);
  if (!section?.notebookId) return null;
  const place = { notebookId: section.notebookId, groupId: section.groupId };
  if (target.zone === 'before') return { ...place, beforeId: section.id };
  const siblings = index.sectionsIn(section.notebookId, section.groupId);
  return { ...place, beforeId: after(siblings, section.id, item.ids) };
}

function groupPlace(index: NotesIndex, item: DragItem, target: DropTarget): GroupPlace | null {
  if (target.kind === 'nb') return { notebookId: target.id, parentGroupId: null, beforeId: null };
  const group = index.group.get(target.id);
  if (!group) return null;
  if (target.zone === 'inside') {
    return { notebookId: group.notebookId, parentGroupId: group.id, beforeId: null };
  }
  const place = { notebookId: group.notebookId, parentGroupId: group.parentGroupId };
  if (target.zone === 'before') return { ...place, beforeId: group.id };
  const siblings = index.groupsIn(group.notebookId, group.parentGroupId);
  return { ...place, beforeId: after(siblings, group.id, item.ids) };
}

function allowedZones(index: NotesIndex, item: DragItem, spot: DropSpot): Zone[] {
  const id = item.ids[0]!;
  const fits = (zone: Zone) => {
    const target = { ...spot, zone };
    switch (item.kind) {
      case 'page': {
        const place = pagePlace(index, item, target);
        return !!place && !checkPagePlace(index, item.ids, place, true);
      }
      case 'section': {
        if (spot.id === id) return false;
        return !!sectionPlace(index, item, target);
      }
      case 'group': {
        if (spot.id === id) return false;
        const place = groupPlace(index, item, target);
        return !!place && !checkGroupMove(index, id, place);
      }
      case 'notebook':
        return spot.kind === 'nb' && spot.id !== id;
    }
  };
  const candidates = ((): readonly Zone[] => {
    switch (`${item.kind}:${spot.kind}`) {
      case 'page:page':
        return ZONES;
      case 'page:pages-end':
      case 'page:tab':
      case 'page:sec':
      case 'section:nb':
      case 'section:gtab':
      case 'group:nb':
        return ['inside'];
      case 'section:grp':
        return ['inside'];
      case 'section:tab':
      case 'section:sec':
      case 'group:gtab':
      case 'notebook:nb':
        return ['before', 'after'];
      case 'group:grp':
        return ZONES;
      default:
        return [];
    }
  })();
  // The inbox is a place for pages only.
  if (spot.kind === 'tab' || spot.kind === 'sec') {
    if (index.section.get(spot.id)?.isInbox && item.kind !== 'page') return [];
  }
  return candidates.filter(fits);
}

/** Keeps the drop rules in step with the current tree. */
export function useDropRules(commands: Commands): void {
  const index = useNotes();
  const actions = useNotesActions();
  useEffect(() => {
    setDropRules({
      zones: (item, spot) => allowedZones(index, item, spot),
      drop(item, target) {
        const id = item.ids[0]!;
        switch (item.kind) {
          case 'page': {
            const place = pagePlace(index, item, target);
            if (place) commands.movePagesTo(item.ids, place);
            break;
          }
          case 'section': {
            const place = sectionPlace(index, item, target);
            if (place) void actions.moveSection(id, place);
            break;
          }
          case 'group': {
            const place = groupPlace(index, item, target);
            if (place) void actions.moveGroup(id, place);
            break;
          }
          case 'notebook': {
            const siblings = index.notebooks;
            const beforeId =
              target.zone === 'before' ? target.id : after(siblings, target.id, item.ids);
            void actions.moveNotebook(id, beforeId);
            break;
          }
        }
      },
    });
    return () => setDropRules(null);
  }, [index, actions, commands]);
}
