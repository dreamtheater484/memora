import { MAX_LAYOUTS } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Columns2, LayoutDashboard, RotateCcw, Save, Trash2 } from 'lucide-react';
import {
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  toast,
} from '../components/ui';
import { askName } from '../kanban/ask';
import { firstBoardId, useProjects } from '../kanban/projects';
import { saveUiState, useUiState } from '../notes/queries';
import { useCurrent } from '../shell/location';
import { shortcutKeys } from '../shell/shortcuts';
import { splitRight } from './actions';
import { PANE_LIMIT, defaultWorkspace, fromLayout, specOfMain, toLayout } from './model';
import { changeWorkspace, useDeviceClass, useWorkspaceStore } from './store';

/*
 * The workspace's menu on wide screens (§9.12): a new pane, and named layouts ("Writing",
 * "Planning") to save and switch between. Named layouts follow the user to every device.
 */

export function LayoutMenu() {
  const cls = useDeviceClass();
  const ui = useUiState();
  const queryClient = useQueryClient();
  const projects = useProjects();
  const { page, boardId } = useCurrent();
  if (!cls) return null;
  const layouts = ui.layouts ?? [];

  const save = () =>
    askName('Save this layout', 'Layout name', async (name) => {
      const ws = useWorkspaceStore.getState().byClass[cls];
      if (!ws) return;
      const rest = layouts.filter((l) => l.name !== name);
      saveUiState(queryClient, { layouts: [...rest, toLayout(ws, name)].slice(-MAX_LAYOUTS) }, 0);
      toast({ title: `Saved “${name}”`, tone: 'success' });
    });

  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="Layout" icon={<LayoutDashboard />} />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem
          icon={<Columns2 />}
          shortcut={shortcutKeys('split-pane')}
          onSelect={() => splitRight(cls, specOfMain(page?.id, boardId))}
        >
          {page ? 'Open the page in a new pane' : 'New pane'}
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Layouts</MenuLabel>
        {layouts.length === 0 && <MenuItem disabled>No saved layouts yet</MenuItem>}
        {layouts.map((layout) => (
          <MenuItem
            key={layout.name}
            onSelect={() => changeWorkspace(cls, () => fromLayout(layout, PANE_LIMIT[cls]))}
          >
            {layout.name}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem icon={<Save />} onSelect={save}>
          Save this layout…
        </MenuItem>
        {layouts.length > 0 && (
          <MenuSub>
            <MenuSubTrigger icon={<Trash2 />}>Delete a layout</MenuSubTrigger>
            <MenuSubContent>
              {layouts.map((layout) => (
                <MenuItem
                  key={layout.name}
                  danger
                  onSelect={() =>
                    saveUiState(
                      queryClient,
                      { layouts: layouts.filter((l) => l.name !== layout.name) },
                      0,
                    )
                  }
                >
                  {layout.name}
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
        )}
        <MenuItem
          icon={<RotateCcw />}
          onSelect={() => changeWorkspace(cls, () => defaultWorkspace(cls, firstBoardId(projects)))}
        >
          Back to the default
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
