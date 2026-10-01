import type { ExportScope, Template } from '@memora/shared';
import { create } from 'zustand';

/** A dialog the shell shows; at most one at a time. */
export type ShellDialog =
  | { kind: 'notebook'; notebookId?: string }
  | { kind: 'move'; type: 'pages' | 'section' | 'group'; ids: string[] }
  | { kind: 'quick-note' }
  | { kind: 'shortcuts' }
  | { kind: 'history'; pageId: string; versionId?: string }
  | { kind: 'save-version'; pageId: string }
  | { kind: 'save-template'; pageId: string }
  | { kind: 'templates' }
  | { kind: 'insert-template'; onPick: (template: Template) => void; title?: string }
  | { kind: 'section-template'; sectionId: string }
  | { kind: 'export'; scope: ExportScope; id?: string }
  | { kind: 'print'; scope: 'page' | 'section'; id: string }
  // Diagrams (§9.3, §9.4): null code starts from the template gallery.
  | {
      kind: 'diagram';
      code: string | null;
      page: 'markdown' | 'rich';
      onDone: (code: string) => void;
    }
  // Kanban (§9.11)
  | { kind: 'new-project' }
  | { kind: 'project'; projectId: string }
  | { kind: 'new-board'; projectId: string }
  | { kind: 'delete-board'; boardId: string }
  | { kind: 'delete-project'; projectId: string }
  | { kind: 'move-card'; cardId: string; boardId: string }
  | { kind: 'link-note'; cardId: string; boardId: string }
  | { kind: 'add-to-board'; pageId: string }
  | {
      kind: 'kanban-name';
      title: string;
      label: string;
      initial: string;
      submit: (name: string) => Promise<unknown>;
    };

/** Where an item is renamed in place: its tab, its navigation row, or a phone list heading. */
export type RenameWhere = 'tabs' | 'nav' | 'list';

export interface Renaming {
  kind: 'section' | 'group';
  id: string;
  where: RenameWhere;
}

interface ShellState {
  /** Drawers, used below the desktop breakpoint. */
  navOpen: boolean;
  pagesOpen: boolean;
  paletteOpen: boolean;
  dialog: ShellDialog | null;
  renaming: Renaming | null;
  /** The page whose title is being edited in the page header. */
  editingTitle: string | null;
  /** Pages selected together in the page list (besides the open one). */
  selection: string[];
  /** Where a Shift+click range starts. */
  anchor: string | null;

  setNavOpen: (open: boolean) => void;
  setPagesOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  openDialog: (dialog: ShellDialog) => void;
  closeDialog: () => void;
  setRenaming: (renaming: Renaming | null) => void;
  setEditingTitle: (pageId: string | null) => void;
  select: (ids: string[], anchor?: string | null) => void;
}

/** Layout and transient UI state; where you are lives in the URL. */
export const useShell = create<ShellState>()((set) => ({
  navOpen: false,
  pagesOpen: false,
  paletteOpen: false,
  dialog: null,
  renaming: null,
  editingTitle: null,
  selection: [],
  anchor: null,

  setNavOpen: (navOpen) => set({ navOpen }),
  setPagesOpen: (pagesOpen) => set({ pagesOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openDialog: (dialog) => set({ dialog, paletteOpen: false }),
  closeDialog: () => set({ dialog: null }),
  setRenaming: (renaming) => set({ renaming }),
  setEditingTitle: (editingTitle) => set({ editingTitle }),
  select: (selection, anchor) =>
    set((s) => ({ selection, anchor: anchor === undefined ? s.anchor : anchor })),
}));
