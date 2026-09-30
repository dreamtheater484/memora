import type { AuditEntry, AuditEvent } from '@memora/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ArchiveRestore,
  Ban,
  CircleCheck,
  DatabaseBackup,
  Download,
  FileDown,
  FileUp,
  KeyRound,
  LifeBuoy,
  LogIn,
  LogOut,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  UserPen,
  UserPlus,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { FormError } from '../auth/AuthLayout';
import { auditQuery } from '../auth/queries';
import { Button, Skeleton } from '../components/ui';
import { errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/time';
import { SettingsSection } from './SettingsLayout';

const target = (entry: AuditEntry) =>
  typeof entry.meta.target === 'string' ? entry.meta.target : 'a user';

const EVENTS: Record<
  AuditEvent,
  { icon: ReactNode; text: (e: AuditEntry) => string; alert?: boolean }
> = {
  setup_completed: { icon: <Sparkles />, text: () => 'set up Memora' },
  login: {
    icon: <LogIn />,
    text: (e) => `logged in${typeof e.meta.device === 'string' ? ` on ${e.meta.device}` : ''}`,
  },
  login_failed: {
    icon: <ShieldAlert />,
    alert: true,
    text: (e) =>
      e.meta.reason === 'unknown_user'
        ? 'login failed: no such user'
        : e.meta.reason === 'disabled'
          ? 'login refused: account disabled'
          : e.meta.reason === 'wrong_code'
            ? 'login failed: wrong code'
            : 'login failed: wrong password',
  },
  logout: { icon: <LogOut />, text: () => 'logged out' },
  password_changed: { icon: <KeyRound />, text: () => 'changed their password' },
  profile_updated: { icon: <UserPen />, text: () => 'updated their profile' },
  session_revoked: { icon: <LogOut />, text: () => 'signed out a device' },
  user_created: { icon: <UserPlus />, text: (e) => `added ${target(e)}` },
  user_updated: { icon: <UserPen />, text: (e) => `edited ${target(e)}` },
  user_disabled: { icon: <Ban />, text: (e) => `disabled ${target(e)}` },
  user_enabled: { icon: <CircleCheck />, text: (e) => `enabled ${target(e)}` },
  user_deleted: { icon: <Trash2 />, text: (e) => `deleted ${target(e)}` },
  password_reset: { icon: <KeyRound />, text: (e) => `reset the password of ${target(e)}` },
  backup_created: { icon: <DatabaseBackup />, text: () => 'made a backup' },
  backup_downloaded: { icon: <Download />, text: () => 'downloaded a backup' },
  backup_restored: {
    icon: <ArchiveRestore />,
    alert: true,
    text: (e) =>
      `restored the backup ${typeof e.meta.backup === 'string' ? e.meta.backup : ''}`.trim(),
  },
  backup_deleted: { icon: <Trash2 />, text: () => 'deleted a backup' },
  two_factor_enabled: { icon: <ShieldCheck />, text: () => 'turned on two-step verification' },
  two_factor_disabled: {
    icon: <ShieldOff />,
    alert: true,
    text: () => 'turned off two-step verification',
  },
  two_factor_reset: {
    icon: <ShieldOff />,
    alert: true,
    text: (e) => `turned off two-step verification for ${target(e)}`,
  },
  recovery_codes_created: { icon: <KeyRound />, text: () => 'made new recovery codes' },
  recovery_code_used: {
    icon: <LifeBuoy />,
    alert: true,
    text: () => 'logged in with a recovery code',
  },
  security_changed: {
    icon: <Settings2 />,
    text: (e) =>
      e.meta.requireTwoFactor === true
        ? 'required two-step verification for everyone'
        : 'stopped requiring two-step verification',
  },
  export_created: { icon: <FileDown />, text: () => 'exported pages' },
  import_completed: { icon: <FileUp />, text: () => 'imported pages' },
};

/** Security-relevant events (§9.1): logins, failed logins, and account changes. */
export function AuditPage() {
  const audit = useInfiniteQuery(auditQuery);
  const entries = audit.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <SettingsSection
      title="Audit log"
      description="Logins and account changes, newest first. Kept for a year."
    >
      {audit.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : audit.isError ? (
        <FormError message={errorMessage(audit.error)} />
      ) : (
        <>
          <ol className="-my-1.5 divide-y divide-line">
            {entries.map((entry) => {
              const kind = EVENTS[entry.event] ?? { icon: null, text: () => entry.event };
              return (
                <li key={entry.id} className="flex items-start gap-3 py-2.5">
                  <span
                    className={
                      kind.alert
                        ? 'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-warn/15 text-warn [&_svg]:size-3.5'
                        : 'mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-hover text-fg-2 [&_svg]:size-3.5'
                    }
                  >
                    {kind.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-semibold">{entry.username ?? 'Someone'}</span>{' '}
                      {kind.text(entry)}
                    </p>
                    <p className="text-xs text-fg-3">
                      <time dateTime={new Date(entry.createdAt).toISOString()}>
                        {formatDateTime(entry.createdAt)}
                      </time>
                      {entry.ip && <> · {entry.ip}</>}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {audit.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                size="sm"
                onClick={() => void audit.fetchNextPage()}
                disabled={audit.isFetchingNextPage}
              >
                {audit.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
              </Button>
            </div>
          )}
        </>
      )}
    </SettingsSection>
  );
}
