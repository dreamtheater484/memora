import { APP_NAME } from '@memora/shared';
import { useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  FilePlus,
  Keyboard,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  PanelRight,
  Search,
  Settings,
  Sun,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCurrentUser, useLogout } from '../auth/queries';
import {
  Avatar,
  IconButton,
  Kbd,
  Logo,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from '../components/ui';
import { hueStyle } from '../theme/sections';
import { useTheme, type ThemeMode } from '../theme/theme';
import { useCommands } from './commands';
import { useProjects } from '../kanban/projects';
import { isNotesLevel, useCurrent, useGo, type Current } from './location';
import { shortcutKeys } from './shortcuts';
import { useShell } from './store';
import { GlobalSaveIndicator } from './SyncStatus';

const THEME_ICON = { system: <Monitor />, light: <Sun />, dark: <Moon /> };

function useBoardOf(boardId: string | null) {
  const data = useProjects();
  const board = data.boards.find((b) => b.id === boardId);
  return { project: data.projects.find((p) => p.id === board?.projectId), board };
}

function Crumbs() {
  const current = useCurrent();
  const go = useGo();
  const boardOf = useBoardOf(current.boardId);
  let parts: { label: string; onClick?: () => void }[];
  if (current.level === 'board') {
    const { project, board } = boardOf;
    parts = [{ label: project?.name ?? '' }, { label: board?.name ?? '' }];
  } else if (current.path) {
    const { notebook, groups, section } = current.path;
    parts = [
      ...(notebook ? [{ label: notebook.name, onClick: () => go.notebook(notebook.id) }] : []),
      ...groups.map((g) => ({ label: g.name, onClick: () => go.group(g.id) })),
      { label: section.name, onClick: () => go.section(section.id) },
    ];
  } else parts = [];
  return (
    <nav
      aria-label="Location"
      className="ml-1 hidden min-w-0 items-center gap-1 overflow-hidden border-l border-line pl-2.5 text-sm whitespace-nowrap text-fg-2 @desktop:flex"
    >
      <ol className="flex min-w-0 items-center gap-1">
        {parts.map((p, i) => {
          const last = i === parts.length - 1;
          return (
            <li key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-3" />}
              {last ? (
                <b aria-current="location" className="truncate font-semibold text-fg">
                  {p.label}
                </b>
              ) : p.onClick ? (
                <button
                  type="button"
                  onClick={p.onClick}
                  className="truncate rounded-xs hover:text-fg"
                >
                  {p.label}
                </button>
              ) : (
                <span className="truncate">{p.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Where "back" goes on a phone: one level up the drill-down. */
function parentOf(current: Current, go: ReturnType<typeof useGo>): (() => void) | null {
  const { level, section, group, path } = current;
  switch (level) {
    case 'page':
      return section ? () => go.section(section.id) : go.home;
    case 'section': {
      if (!section || section.isInbox || !path?.notebook) return go.home;
      const inner = path.groups.at(-1);
      const notebookId = path.notebook.id;
      return inner ? () => go.group(inner.id) : () => go.notebook(notebookId);
    }
    case 'group':
      return group?.parentGroupId
        ? () => go.group(group.parentGroupId!)
        : group
          ? () => go.notebook(group.notebookId)
          : go.home;
    case 'notebook':
    case 'board':
      return go.home;
    default:
      return null;
  }
}

function PhoneTitle() {
  const current = useCurrent();
  const boardOf = useBoardOf(current.boardId);
  const { level, section, page, notebook, group } = current;
  let over: ReactNode = null;
  let title: string;
  if (level === 'board') title = boardOf.board?.name ?? 'Boards';
  else if (level === 'home') title = 'Notes';
  else if (level === 'notebook') title = notebook?.name ?? 'Notebook';
  else if (level === 'group') {
    title = group?.name ?? 'Section group';
    over = notebook?.name;
  } else {
    title = level === 'page' ? page?.title || 'Untitled page' : (section?.name ?? '');
    if (level === 'page' && section) {
      over = (
        <span className="hue flex items-center gap-1.5" style={hueStyle(section.color)}>
          <span aria-hidden className="size-2 rounded-full bg-sec" />
          {section.name}
        </span>
      );
    } else over = section?.isInbox ? null : notebook?.name;
  }
  return (
    <div className="flex min-w-0 flex-col leading-tight @tablet:hidden">
      {over && <small className="truncate text-2xs text-fg-2">{over}</small>}
      <b className="truncate text-md font-semibold">{title}</b>
    </div>
  );
}

function AppearanceMenu() {
  const { theme, glass, setTheme, setGlass } = useTheme();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="Appearance" icon={THEME_ICON[theme]} />
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeMode)}>
          <MenuRadioItem value="system">Match system</MenuRadioItem>
          <MenuRadioItem value="light">Light</MenuRadioItem>
          <MenuRadioItem value="dark">Dark</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuCheckboxItem
          checked={glass !== 'off'}
          onCheckedChange={(on) => setGlass(on ? 'auto' : 'off')}
        >
          Glass effects
        </MenuCheckboxItem>
      </MenuContent>
    </Menu>
  );
}

function AccountMenu() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const logout = useLogout();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button type="button" aria-label="Account" className="rounded-full">
          <Avatar name={user.displayName} decorative />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel>
          {/* The label style is a small uppercase heading; a name reads better as is. */}
          <span className="block text-sm font-semibold tracking-normal text-fg normal-case">
            {user.displayName}
          </span>
          <span className="block font-normal tracking-normal normal-case">@{user.username}</span>
        </MenuLabel>
        <MenuItem icon={<Settings />} onSelect={() => void navigate({ to: '/settings/account' })}>
          Account settings
        </MenuItem>
        {user.role === 'admin' && (
          <MenuItem icon={<Users />} onSelect={() => void navigate({ to: '/settings/users' })}>
            Users
          </MenuItem>
        )}
        <MenuItem
          icon={<Keyboard />}
          shortcut="?"
          onSelect={() => useShell.getState().openDialog({ kind: 'shortcuts' })}
        >
          Keyboard shortcuts
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => logout.mutate()}>
          Log out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function TopBar() {
  const current = useCurrent();
  const go = useGo();
  const commands = useCommands();
  const { setNavOpen, setPagesOpen, setPaletteOpen } = useShell();
  const back = parentOf(current, go);
  const notes = isNotesLevel(current.level);
  return (
    <header className="relative z-10 flex h-[3.375rem] shrink-0 items-center gap-1 pr-1.5 pl-1 @tablet:h-[3.625rem] @tablet:gap-2.5 @tablet:px-4">
      {/* Space is shared like this: the brand and the buttons keep their size,
          the location and the search field give way. */}
      <span className="contents @tablet:hidden">
        {back ? (
          <IconButton label="Back" icon={<ArrowLeft />} onClick={back} />
        ) : (
          <IconButton label="Navigation" icon={<MenuIcon />} onClick={() => setNavOpen(true)} />
        )}
      </span>
      <div className="hidden shrink-0 items-center gap-2 font-display text-lg font-semibold tracking-tight @tablet:flex">
        <Logo />
        <span>{APP_NAME}</span>
      </div>
      <div className="flex min-w-0 flex-[1_1_0%] items-center">
        {/* In-app back and forward (§9.8), besides the browser's own. */}
        <span className="ml-1 hidden shrink-0 items-center @desktop:flex">
          <IconButton
            label="Back"
            icon={<ArrowLeft />}
            size="sm"
            shortcut={shortcutKeys('back')}
            onClick={() => window.history.back()}
          />
          <IconButton
            label="Forward"
            icon={<ArrowRight />}
            size="sm"
            shortcut={shortcutKeys('forward')}
            onClick={() => window.history.forward()}
          />
        </span>
        <Crumbs />
        <PhoneTitle />
      </div>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="hidden h-[2.125rem] min-w-0 flex-[0_1_27.5rem] items-center gap-2 rounded-full border border-(--glass-edge) bg-panel pr-2 pl-3 text-sm text-fg-3 shadow-card backdrop-blur-lg transition-colors hover:text-fg-2 @tablet:flex"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search notes, cards and commands</span>
        <Kbd className="bg-transparent">{shortcutKeys('palette')}</Kbd>
      </button>
      <div className="flex flex-[1_0_0%] items-center justify-end gap-1.5">
        <GlobalSaveIndicator />
        {notes && current.section && (
          <span className="hidden @tablet:contents @desktop:hidden">
            <IconButton label="Pages" icon={<PanelRight />} onClick={() => setPagesOpen(true)} />
          </span>
        )}
        {/* Wrappers, because "hidden" and a component's own display class would clash. */}
        {notes && current.section && (
          <span className="hidden @tablet:contents">
            <IconButton
              label="New page"
              icon={<FilePlus />}
              shortcut={shortcutKeys('new-page')}
              onClick={() => void commands.newPage()}
            />
          </span>
        )}
        <AppearanceMenu />
        <span className="hidden @tablet:contents">
          <AccountMenu />
        </span>
      </div>
    </header>
  );
}
