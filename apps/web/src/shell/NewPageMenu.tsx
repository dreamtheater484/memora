import { ChevronDown, FilePlus, LayoutTemplate, Plus } from 'lucide-react';
import {
  Button,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from '../components/ui';
import { useUiState } from '../notes/queries';
import { chooseSectionTemplate, useTemplates } from '../templates/templates';
import { useCommands } from './commands';
import { useShell } from './store';

/*
 * "+ Page ▾" (§9.9): a new page (from the section's default template, if it has one), or a
 * blank one, or one from any template; and which template is the section's default.
 */
export function NewPageMenu({ sectionId }: { sectionId: string }) {
  const commands = useCommands();
  const templates = useTemplates();
  const chosenId = useUiState().sectionTemplates?.[sectionId];
  const chosen = templates.find((t) => t.id === chosenId);
  return (
    <div className="flex shrink-0">
      <Button
        size="sm"
        variant="primary"
        className="rounded-r-none pr-2"
        title={chosen ? `New page from “${chosen.name}”` : 'New page'}
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
          <MenuItem icon={<LayoutTemplate />} onSelect={() => chooseSectionTemplate(sectionId)}>
            {chosen ? `Default template: ${chosen.name}…` : 'Default template…'}
          </MenuItem>
          <MenuItem onSelect={() => useShell.getState().openDialog({ kind: 'templates' })}>
            Manage templates…
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
