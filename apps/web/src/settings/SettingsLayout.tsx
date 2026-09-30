import { Link, Outlet } from '@tanstack/react-router';
import {
  ArrowLeft,
  ArrowUpDown,
  DatabaseBackup,
  MonitorSmartphone,
  PenLine,
  ScrollText,
  UserRound,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useCurrentUser } from '../auth/queries';
import { cn } from '../lib/cn';

interface NavItem {
  to:
    | '/settings/account'
    | '/settings/editing'
    | '/settings/data'
    | '/settings/device'
    | '/settings/users'
    | '/settings/audit'
    | '/settings/backups';
  label: string;
  icon: ReactNode;
  admin?: boolean;
}

const NAV: NavItem[] = [
  { to: '/settings/account', label: 'Account', icon: <UserRound /> },
  { to: '/settings/editing', label: 'Editing', icon: <PenLine /> },
  { to: '/settings/data', label: 'Import & export', icon: <ArrowUpDown /> },
  { to: '/settings/device', label: 'This device', icon: <MonitorSmartphone /> },
  { to: '/settings/users', label: 'Users', icon: <Users />, admin: true },
  { to: '/settings/audit', label: 'Audit log', icon: <ScrollText />, admin: true },
  { to: '/settings/backups', label: 'Backups', icon: <DatabaseBackup />, admin: true },
];

/**
 * Settings (§9.16): a navigation list beside the content on larger screens, tabs across the
 * top on phones. More groups (appearance, data) join as their phases arrive.
 */
export function SettingsLayout() {
  const user = useCurrentUser();
  const items = NAV.filter((item) => !item.admin || user.role === 'admin');
  return (
    <div className="aurora-bg flex h-full flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[64rem] flex-1 flex-col gap-4 px-3 py-3 tablet:gap-6 tablet:px-6 tablet:py-6">
        <header className="flex items-center gap-2">
          <Link
            to="/"
            className="inline-flex h-8 items-center gap-1.5 rounded-full pr-3 pl-2 text-sm font-semibold text-fg-2 hover:bg-hover hover:text-fg [&_svg]:size-4"
          >
            <ArrowLeft aria-hidden />
            Notes
          </Link>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
        </header>
        <div className="flex flex-1 flex-col gap-4 tablet:flex-row tablet:items-start tablet:gap-6">
          <nav aria-label="Settings" className="shrink-0 tablet:sticky tablet:top-6 tablet:w-52">
            <ul className="glass flex gap-1 overflow-x-auto rounded-xl p-1.5 tablet:flex-col">
              {items.map((item) => (
                <li key={item.to} className="shrink-0">
                  <Link
                    to={item.to}
                    className={cn(
                      'flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm font-medium whitespace-nowrap text-fg-2 [&_svg]:size-4 [&_svg]:shrink-0',
                      'hover:bg-hover hover:text-fg',
                      'aria-[current=page]:bg-accent-soft aria-[current=page]:font-semibold aria-[current=page]:text-fg',
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <main className="flex min-w-0 flex-1 flex-col gap-4 tablet:gap-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

export interface SettingsSectionProps {
  title: string;
  description?: ReactNode;
  /** Buttons on the right of the heading. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** One card of settings, with a heading. */
export function SettingsSection({
  title,
  description,
  actions,
  children,
  className,
}: SettingsSectionProps) {
  return (
    <section
      className={cn('glass rounded-xl [--glass-bg:var(--surface)]', className)}
      aria-label={title}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5 tablet:px-5">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-2">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>
      <div className="px-4 py-4 tablet:px-5">{children}</div>
    </section>
  );
}
