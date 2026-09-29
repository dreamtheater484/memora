import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FilePlus, LayoutTemplate, Plus } from 'lucide-react';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '../components/ui';
import { saveUiState, useUiState } from '../notes/queries';
import { useTemplates } from '../templates/templates';
import { useCommands } from './commands';
import { useShell } from './store';

/*
 * "New page ▾" (§9.9): a new page (from the section's default template, if it has one), or a
 * blank one, or one from any template; and which template is the section's default.
 */
export function NewPageMenu({ sectionId }: { sectionId: string }) {
  const commands = useCommands();
  const queryClient = useQueryClient();
  const templates = useTemplates();
  const chosen = useUiState().sectionTemplates?.[sectionId] ?? null;
  return (
    <div className="flex shrink-0">
      <Button
        size="sm"
        variant="primary"
        className="rounded-r-none pr-2"
        onClick={() => void commands.newPage({ sectionId })}
      >
        <Plus /> Page
      </Button>
      <Menu>
        <MenuTrigger asChild>
          <Button
            size="sm"
            variant="primary"
            aria-label="New page from a template"
            className="rounded-l-none border-l border-l-on-accent/25 px-1.5"
          >
            <ChevronDown />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem
            icon={<FilePlus />}
            onSelect={() => void commands.newPage({ sectionId, type: 'markdown', template: null })}
          >
            Blank Markdown page
          </MenuItem>
          <MenuItem
            icon={<FilePlus />}
            onSelect={() => void commands.newPage({ sectionId, type: 'rich', template: null })}
          >
            Blank rich text page
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>From a template</MenuLabel>
          {templates.map((t) => (
            <MenuItem
              key={t.id}
              icon={<LayoutTemplate />}
              onSelect={() => void commands.newPage({ sectionId, template: t })}
            >
              {t.name}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuSub>
            <MenuSubTrigger icon={<LayoutTemplate />}>Default for this section</MenuSubTrigger>
            <MenuSubContent>
              <MenuRadioGroup
                value={chosen ?? 'none'}
                onValueChange={(v) =>
                  saveUiState(queryClient, {
                    sectionTemplates: { [sectionId]: v === 'none' ? null : v },
                  })
                }
              >
                <MenuRadioItem value="none">Blank page</MenuRadioItem>
                {templates.map((t) => (
                  <MenuRadioItem key={t.id} value={t.id}>
                    {t.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuSubContent>
          </MenuSub>
          <MenuItem onSelect={() => useShell.getState().openDialog({ kind: 'templates' })}>
            Manage templates…
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
