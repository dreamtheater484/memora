import type { PaneTabSpec } from '@memora/shared';
import { toast } from '../components/ui';
import { PANE_LIMIT, withPane, withTab, type DeviceClass } from './model';
import { changeWorkspace, useWorkspaceStore } from './store';

/*
 * What menus, the command palette and shortcuts do with the workspace (§9.12).
 */

const noRoom = (): void => {
  toast({
    title: 'No room for another pane',
    description: 'Close a pane first, or open this in a tab of one.',
  });
};

/** Shows `spec` in the last pane, or in a new pane when there is none. */
export function openInPane(cls: DeviceClass, spec: PaneTabSpec): void {
  const ws = useWorkspaceStore.getState().byClass[cls];
  if (!ws) return;
  const last = ws.panes.at(-1);
  if (last) changeWorkspace(cls, (w) => withTab(w, last.id, spec));
  else changeWorkspace(cls, (w) => withPane(w, [spec], PANE_LIMIT[cls]));
}

/** A new pane at the right, showing `spec` (or offering what to open). */
export function splitRight(cls: DeviceClass, spec: PaneTabSpec | null): void {
  const ws = useWorkspaceStore.getState().byClass[cls];
  if (!ws) return;
  if (ws.panes.length >= PANE_LIMIT[cls]) return noRoom();
  changeWorkspace(cls, (w) => withPane(w, spec ? [spec] : [], PANE_LIMIT[cls], w.panes.at(-1)?.id));
}

/** A new pane right after `paneId`, showing `spec`. */
export function splitPane(cls: DeviceClass, paneId: string, spec: PaneTabSpec | null): void {
  const ws = useWorkspaceStore.getState().byClass[cls];
  if (!ws) return;
  if (ws.panes.length >= PANE_LIMIT[cls]) return noRoom();
  changeWorkspace(cls, (w) => withPane(w, spec ? [spec] : [], PANE_LIMIT[cls], paneId));
}
