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
  | { kind: 'insert-template'; onPick: (template: Template) => void }
  | { kind: 'export'; scope: ExportScope; id?: string }
  | { kind: 'print'; scope: 'page' | 'section'; id: string };

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
  /** Second editor pane on ultra-wide screens, and the page open there. */
  secondPane: boolean;
  secondPageId: string | null;
  /** Share of the main pane when the second pane is open, in percent. */
  split: number;

  setNavOpen: (open: boolean) => void;
  setPagesOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  openDialog: (dialog: ShellDialog) => void;
  closeDialog: () => void;
  setRenaming: (renaming: Renaming | null) => void;
  setEditingTitle: (pageId: string | null) => void;
  select: (ids: string[], anchor?: string | null) => void;
  setSecondPane: (open: boolean, pageId?: string | null) => void;
  setSplit: (size: number) => void;
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
  secondPane: true,
  secondPageId: null,
  split: 56,

  setNavOpen: (navOpen) => set({ navOpen }),
  setPagesOpen: (pagesOpen) => set({ pagesOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  openDialog: (dialog) => set({ dialog, paletteOpen: false }),
  closeDialog: () => set({ dialog: null }),
  setRenaming: (renaming) => set({ renaming }),
  setEditingTitle: (editingTitle) => set({ editingTitle }),
  select: (selection, anchor) =>
    set((s) => ({ selection, anchor: anchor === undefined ? s.anchor : anchor })),
  setSecondPane: (secondPane, pageId) =>
    set((s) => ({ secondPane, secondPageId: pageId === undefined ? s.secondPageId : pageId })),
  setSplit: (split) => set({ split }),
}));
