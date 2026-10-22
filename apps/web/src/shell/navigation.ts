import { useQueryClient } from '@tanstack/react-query';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import { saveUiState, useUiState } from '../notes/queries';
import { useShell } from './store';

/*
 * The navigation (notebooks, boards, the Inbox) slides in over the notes when asked for, or,
 * pinned, stays open beside them as a column of its own on desktop widths.
 */

/** Whether the navigation is pinned open beside the notes: on desktop widths, when asked for. */
export function useNavDocked(): boolean {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const pinned = !!useUiState().navPinned;
  return desktop && pinned;
}

/** Slides the navigation in or out; pinned open, hides it instead. */
export function useToggleNavigation(): () => void {
  const queryClient = useQueryClient();
  const docked = useNavDocked();
  return () => {
    const shell = useShell.getState();
    if (docked) saveUiState(queryClient, { navPinned: false });
    else shell.setNavOpen(!shell.navOpen);
  };
}
