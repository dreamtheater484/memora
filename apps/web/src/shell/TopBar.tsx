import { APP_NAME } from '@memora/shared';
import { useNavigate } from '@tanstack/react-router';
import {
  ChevronRight,
  FilePlus,
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
  SaveIndicator,
  toast,
  type SaveState,
} from '../components/ui';
import { hueStyle } from '../theme/sections';
import { useTheme, type ThemeMode } from '../theme/theme';
import { findSection, flatPages, PROJECTS } from './demo';
import { useShell } from './store';

const THEME_ICON = { system: <Monitor />, light: <Sun />, dark: <Moon /> };

function Crumbs() {
  const { view, sectionId } = useShell();
  let parts: string[];
  if (view.kind === 'board') {
    const project = PROJECTS.find((p) => p.boards.some((b) => b.id === view.boardId));
    parts = [project?.name ?? '', project?.boards.find((b) => b.id === view.boardId)?.name ?? ''];
  } else {
    const found = findSection(sectionId);
    parts = found
      ? [found.notebook.name, found.section.group, found.section.name].filter(
          (p): p is string => !!p,
        )
      : [];
  }
  return (
    <nav
      aria-label="Location"
      className="ml-1 hidden min-w-0 items-center gap-1 overflow-hidden border-l border-line pl-2.5 text-sm whitespace-nowrap text-fg-2 @desktop:flex"
    >
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-3" />}
          {i === parts.length - 1 ? <b className="font-semibold text-fg">{p}</b> : p}
        </span>
      ))}
    </nav>
  );
}

function PhoneTitle() {
  const { view, sectionId, pageId } = useShell();
  const found = findSection(sectionId);
  if (view.kind === 'board' || !found) {
    return <b className="truncate text-md font-semibold @tablet:hidden">Boards</b>;
  }
  const page = flatPages(sectionId).find((p) => p.id === pageId);
  return (
    <div className="flex min-w-0 flex-col leading-tight @tablet:hidden">
      <small
        className="hue flex items-center gap-1.5 text-2xs text-fg-2"
        style={hueStyle(found.section.color)}
      >
        <span aria-hidden className="size-2 rounded-full bg-sec" />
        {found.section.name}
      </small>
      <b className="truncate text-md font-semibold">{page?.title ?? found.section.name}</b>
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
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => logout.mutate()}>
          Log out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

export function TopBar({ saveState }: { saveState: SaveState }) {
  const { view, setNavOpen, setPagesOpen, setPaletteOpen } = useShell();
  return (
    <header className="relative z-10 flex h-[3.375rem] shrink-0 items-center gap-1 pr-1.5 pl-1 @tablet:h-[3.625rem] @tablet:gap-2.5 @tablet:px-4">
      {/* Space is shared like this: the brand and the buttons keep their size,
          the location and the search field give way. */}
      <IconButton
        label="Notebooks"
        icon={<MenuIcon />}
        onClick={() => setNavOpen(true)}
        className="@tablet:hidden"
      />
      <div className="hidden shrink-0 items-center gap-2 font-display text-lg font-semibold tracking-tight @tablet:flex">
        <Logo />
        <span>{APP_NAME}</span>
      </div>
      <div className="flex min-w-0 flex-[1_1_0%] items-center">
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
        <Kbd className="bg-transparent">Ctrl K</Kbd>
      </button>
      <div className="flex flex-[1_0_0%] items-center justify-end gap-1.5">
        <SaveIndicator state={saveState} />
        {view.kind === 'notes' && (
          <IconButton
            label="Pages"
            icon={<PanelRight />}
            onClick={() => setPagesOpen(true)}
            className="@desktop:hidden"
          />
        )}
        {/* Wrappers, because "hidden" and a component's own display class would clash. */}
        <span className="hidden @tablet:contents">
          <IconButton
            label="New page"
            icon={<FilePlus />}
            shortcut="Ctrl Alt N"
            onClick={() => toast('Creating pages arrives with the editor (Phase 5).')}
          />
        </span>
        <AppearanceMenu />
        <span className="hidden @tablet:contents">
          <AccountMenu />
        </span>
      </div>
    </header>
  );
}
