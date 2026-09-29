import { create } from 'zustand';
import { flatPages } from './demo';

export type ShellView = { kind: 'notes' } | { kind: 'board'; boardId: string };

interface ShellState {
  view: ShellView;
  sectionId: string;
  pageId: string | null;
  /** Drawers, used below the desktop breakpoint. */
  navOpen: boolean;
  pagesOpen: boolean;
  paletteOpen: boolean;
  /** Second editor pane on ultra-wide screens. */
  secondPane: boolean;
  /** Share of the main pane when the second pane is open, in percent. */
  split: number;

  openSection: (id: string) => void;
  openPage: (id: string) => void;
  openBoard: (id: string) => void;
  setNavOpen: (open: boolean) => void;
  setPagesOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  setSecondPane: (open: boolean) => void;
  setSplit: (size: number) => void;
}

/** UI state of the app shell (placeholder until routes carry it in Phase 3). */
export const useShell = create<ShellState>()((set) => ({
  view: { kind: 'notes' },
  sectionId: 'roadmap',
  pageId: 'q4',
  navOpen: false,
  pagesOpen: false,
  paletteOpen: false,
  secondPane: true,
  split: 56,

  openSection: (id) =>
    set({
      view: { kind: 'notes' },
      sectionId: id,
      pageId: flatPages(id)[0]?.id ?? null,
      navOpen: false,
    }),
  openPage: (id) => set({ view: { kind: 'notes' }, pageId: id, pagesOpen: false }),
  openBoard: (id) => set({ view: { kind: 'board', boardId: id }, navOpen: false }),
  setNavOpen: (navOpen) => set({ navOpen }),
  setPagesOpen: (pagesOpen) => set({ pagesOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSecondPane: (secondPane) => set({ secondPane }),
  setSplit: (split) => set({ split }),
}));
