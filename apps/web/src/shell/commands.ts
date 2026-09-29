import {
  MAX_PAGE_DEPTH,
  pickColor,
  type ColorId,
  type PageType,
  type Template,
} from '@memora/shared';
import { useMemo } from 'react';
import { toast } from '../components/ui';
import {
  checkPagePlace,
  indentPlace,
  outdentPlace,
  shiftPlace,
  topmostPages,
  type NotesIndex,
  type PagePlace,
} from '../notes/model';
import { useEditorSettings, useNotesActions, useUiState } from '../notes/queries';
import { contentFor, useTemplates } from '../templates/templates';
import { useCurrent, useGo, type Current } from './location';
import { useShell, type RenameWhere } from './store';

/*
 * What people do, whichever way they ask: a shortcut, a context menu, the command palette or
 * a button. Commands act on where you are and on the selected pages.
 */

/** A colour not yet used by the sections next to it, so new tabs are easy to tell apart. */
export function nextColor(index: NotesIndex, notebookId: string | null): ColorId {
  return pickColor((notebookId ? index.allSectionsOf(notebookId) : []).map((s) => s.color));
}

/** Selected pages in list order, or the open page when nothing else is selected. */
function pagesToActOn(current: Current): string[] {
  const { selection } = useShell.getState();
  const open = current.page?.id;
  if (!current.section) return [];
  const rows = current.index.pagesOf(current.section.id);
  const picked = new Set(selection.length ? selection : open ? [open] : []);
  return rows.filter((r) => picked.has(r.page.id)).map((r) => r.page.id);
}

export function useCommands() {
  const current = useCurrent();
  const actions = useNotesActions();
  const go = useGo();
  const { pageType } = useEditorSettings();
  const { sectionTemplates } = useUiState();
  const templates = useTemplates();

  return useMemo(() => {
    const { index, section, page } = current;
    const shell = () => useShell.getState();

    /** Opens a page next to the ones leaving (deleted or moved away), or the section. */
    const leaveDeletedPages = (ids: string[]) => {
      if (!page || !section || !ids.includes(page.id)) return;
      const gone = new Set(topmostPages(index, ids).flatMap((p) => [p.id, ...below(index, p.id)]));
      const rows = index.pagesOf(section.id);
      const at = rows.findIndex((r) => r.page.id === page.id);
      const next =
        rows.slice(at + 1).find((r) => !gone.has(r.page.id)) ??
        rows
          .slice(0, at)
          .reverse()
          .find((r) => !gone.has(r.page.id));
      if (next) go.page(next.page.id, true);
      else go.section(section.id, true);
    };

    const commands = {
      /**
       * A new page, of the type the Editing settings name unless `type` says otherwise, from
       * `template` (null: blank), or else from the section's default template (§9.9). A
       * template saved from a rich page makes a rich page; built-in ones follow the settings.
       */
      async newPage(
        options: {
          subpage?: boolean;
          sectionId?: string;
          type?: PageType;
          template?: Template | null;
        } = {},
      ) {
        const sectionId = options.sectionId ?? section?.id;
        if (!sectionId) return;
        const parentPageId = options.subpage ? (page?.id ?? null) : null;
        if (parentPageId && depthOfPage(index, parentPageId) >= MAX_PAGE_DEPTH) {
          toast({ title: `Pages go at most ${MAX_PAGE_DEPTH} levels deep.`, tone: 'error' });
          return;
        }
        const defaultId = sectionTemplates?.[sectionId];
        const template =
          options.template === undefined
            ? (templates.find((t) => t.id === defaultId) ?? null)
            : options.template;
        const type = options.type ?? (template && !template.builtIn ? template.type : pageType);
        const content = template ? await contentFor(template, type, '') : '';
        const result = await actions.createPage({ sectionId, parentPageId, type, content });
        const created = result?.pages?.[0];
        if (!created) return;
        shell().select([], null);
        go.page(created.id);
        shell().setEditingTitle(created.id);
      },

      async newSection(
        notebookId?: string,
        groupId: string | null = null,
        where: RenameWhere = 'tabs',
      ) {
        const nb = notebookId ?? current.notebook?.id;
        if (!nb) return;
        const result = await actions.createSection({
          notebookId: nb,
          groupId,
          name: 'New section',
          color: nextColor(index, nb),
        });
        const created = result?.sections?.[0];
        if (!created) return;
        go.section(created.id);
        shell().setRenaming({ kind: 'section', id: created.id, where });
      },

      async newGroup(
        notebookId: string,
        parentGroupId: string | null = null,
        where: RenameWhere = 'nav',
      ) {
        const result = await actions.createGroup({
          notebookId,
          parentGroupId,
          name: 'New section group',
        });
        const group = result?.groups?.[0];
        const first = result?.sections?.[0];
        if (!group) return;
        if (where === 'list') go.group(group.id);
        else if (first) go.section(first.id);
        shell().setRenaming({ kind: 'group', id: group.id, where });
      },

      newNotebook: () => shell().openDialog({ kind: 'notebook' }),
      editNotebook: (notebookId: string) => shell().openDialog({ kind: 'notebook', notebookId }),
      quickNote: () => shell().openDialog({ kind: 'quick-note' }),
      showShortcuts: () => shell().openDialog({ kind: 'shortcuts' }),

      rename(where?: RenameWhere) {
        const focus = document.activeElement;
        if (section && (where === 'tabs' || focus?.closest('[data-section-tabs]'))) {
          if (section.isInbox) {
            toast('The Inbox keeps its name.');
            return;
          }
          shell().setRenaming({ kind: 'section', id: section.id, where: 'tabs' });
          return;
        }
        if (page) shell().setEditingTitle(page.id);
      },

      /** Moves pages; when the open page leaves this section, a neighbour opens instead. */
      movePagesTo(ids: string[], place: PagePlace) {
        const verdict = checkPagePlace(index, ids, place, true);
        if (verdict) {
          toast({ title: verdict, tone: 'error' });
          return;
        }
        if (place.sectionId !== section?.id) leaveDeletedPages(ids);
        shell().select([], null);
        void actions.movePages(ids, place);
      },

      movePages(ids = pagesToActOn(current)) {
        if (ids.length) shell().openDialog({ kind: 'move', type: 'pages', ids });
      },

      deletePages(ids = pagesToActOn(current)) {
        if (!ids.length) return;
        leaveDeletedPages(ids);
        shell().select([], null);
        void actions.deletePages(ids);
      },

      duplicatePage(id = page?.id) {
        if (!id) return;
        void actions.duplicatePage(id).then((result) => {
          const copy = result?.pages?.[0];
          if (copy) go.page(copy.id);
        });
      },

      deleteSection(id: string) {
        const target = index.section.get(id);
        if (!target || target.isInbox) return;
        if (section?.id === id) {
          const siblings = target.notebookId ? index.allSectionsOf(target.notebookId) : [];
          const next = siblings.find((s) => s.id !== id);
          if (next) go.section(next.id, true);
          else if (target.notebookId) go.notebook(target.notebookId);
        }
        void actions.deleteSection(id);
      },

      deleteGroup(id: string) {
        if (current.path?.groups.some((g) => g.id === id)) {
          const group = index.group.get(id);
          if (group) go.notebook(group.notebookId);
        }
        void actions.deleteGroup(id);
      },

      deleteNotebook(id: string) {
        if (current.notebook?.id === id) go.home();
        void actions.deleteNotebook(id);
      },

      indent() {
        const ids = pagesToActOn(current);
        const place = ids[0] ? indentPlace(index, ids[0]) : null;
        if (!place) return;
        commands.movePagesTo(ids, place);
      },

      outdent() {
        const ids = pagesToActOn(current);
        const place = ids[0] ? outdentPlace(index, ids[0]) : null;
        if (place) commands.movePagesTo(ids, place);
      },

      shiftPage(by: -1 | 1) {
        const ids = pagesToActOn(current);
        const place = ids.length === 1 ? shiftPlace(index, ids[0]!, by) : null;
        if (place) void actions.movePages(ids, place);
      },

      stepPage(by: -1 | 1) {
        if (!section) return;
        const rows = index.pagesOf(section.id);
        const at = rows.findIndex((r) => r.page.id === page?.id);
        const next = rows[at + by];
        if (next) {
          shell().select([], null);
          go.page(next.page.id);
        }
      },

      stepSection(by: -1 | 1) {
        if (!section) return;
        const list = section.notebookId ? index.allSectionsOf(section.notebookId) : [section];
        const next = list[list.findIndex((s) => s.id === section.id) + by];
        if (next) go.section(next.id);
      },
    };
    return commands;
  }, [current, actions, go, pageType, sectionTemplates, templates]);
}

export type Commands = ReturnType<typeof useCommands>;

function depthOfPage(index: NotesIndex, pageId: string): number {
  let depth = 0;
  for (let p: string | null | undefined = pageId; p; p = index.page.get(p)?.parentPageId) depth++;
  return depth;
}

function below(index: NotesIndex, pageId: string): string[] {
  const page = index.page.get(pageId);
  if (!page) return [];
  const rows = index.pagesOf(page.sectionId);
  const at = rows.findIndex((r) => r.page.id === pageId);
  const out: string[] = [];
  for (const row of rows.slice(at + 1)) {
    if (row.depth <= rows[at]!.depth) break;
    out.push(row.page.id);
  }
  return out;
}
