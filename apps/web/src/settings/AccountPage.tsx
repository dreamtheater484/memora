import { PASSWORD_MIN_LENGTH, type SessionInfo } from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import { Laptop, LogOut, Monitor, Smartphone, Tablet } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { FormError } from '../auth/AuthLayout';
import {
  sessionsQuery,
  useChangePassword,
  useCurrentUser,
  useLogout,
  useRevokeSession,
  useUpdateProfile,
} from '../auth/queries';
import {
  Avatar,
  Badge,
  Button,
  Field,
  Input,
  PasswordInput,
  Skeleton,
  toast,
} from '../components/ui';
import { ApiRequestError, errorMessage } from '../lib/api';
import { formatDateTime, formatRelative } from '../lib/time';
import { SettingsSection } from './SettingsLayout';

export function AccountPage() {
  return (
    <>
      <ProfileSection />
      <PasswordSection />
      <SessionsSection />
    </>
  );
}

function fieldsOf(error: unknown): Record<string, string> {
  return error instanceof ApiRequestError ? error.fields : {};
}

function ProfileSection() {
  const user = useCurrentUser();
  const update = useUpdateProfile();
  const [displayName, setDisplayName] = useState(user.displayName);
  const changed = displayName.trim() !== user.displayName;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    update.mutate(displayName, { onSuccess: () => toast('Name saved.') });
  };

  return (
    <SettingsSection title="Profile" description="How you appear in Memora.">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={displayName.trim() || user.displayName} size="lg" decorative />
          <div className="min-w-0">
            <div className="truncate font-semibold">{user.displayName}</div>
            <div className="flex items-center gap-2 text-sm text-fg-2">
              <span className="truncate">@{user.username}</span>
              {user.role === 'admin' && <Badge tone="accent">Administrator</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 tablet:flex-row tablet:items-end">
          <Field
            label="Display name"
            error={fieldsOf(update.error).displayName}
            className="tablet:max-w-sm tablet:flex-1"
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            )}
          </Field>
          <Button
            type="submit"
            disabled={!changed || update.isPending}
            className="self-start tablet:self-auto"
          >
            Save name
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

function PasswordSection() {
  const user = useCurrentUser();
  const change = useChangePassword();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const fields = fieldsOf(change.error);
  const summary =
    change.error && Object.keys(fields).length === 0 ? errorMessage(change.error) : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('');
          setNewPassword('');
          toast('Password changed. Your other devices were signed out.');
        },
      },
    );
  };

  return (
    <SettingsSection
      title="Password"
      description="Changing it signs you out on every other device."
    >
      <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4" noValidate>
        <input type="hidden" autoComplete="username" value={user.username} readOnly />
        <Field label="Current password" error={fields.currentPassword}>
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          )}
        </Field>
        <Field
          label="New password"
          error={fields.newPassword}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.`}
        >
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
          )}
        </Field>
        <FormError message={summary} />
        <Button
          type="submit"
          variant="primary"
          disabled={change.isPending || !currentPassword || !newPassword}
          className="self-start"
        >
          Change password
        </Button>
      </form>
    </SettingsSection>
  );
}

function deviceIcon(label: string): ReactNode {
  if (/iPhone|Android/.test(label)) return <Smartphone />;
  if (/iPad/.test(label)) return <Tablet />;
  if (/Windows|macOS|Linux|ChromeOS/.test(label)) return <Laptop />;
  return <Monitor />;
}

function SessionsSection() {
  const sessions = useQuery(sessionsQuery);
  const revoke = useRevokeSession();
  const logout = useLogout();
  const others = sessions.data?.filter((s) => !s.current) ?? [];

  const signOut = (session: SessionInfo) => {
    if (session.current) {
      logout.mutate();
      return;
    }
    revoke.mutate(session.id, {
      onSuccess: () => toast(`Signed out ${session.deviceLabel}.`),
      onError: (error) => toast(errorMessage(error)),
    });
  };

  const signOutOthers = async () => {
    try {
      await Promise.all(others.map((s) => revoke.mutateAsync(s.id)));
      toast('Signed out on all other devices.');
    } catch (error) {
      toast(errorMessage(error));
    }
  };

  return (
    <SettingsSection
      title="Devices"
      description="Where you’re signed in. Sign out any device you don’t recognise."
      actions={
        others.length > 1 && (
          <Button size="sm" onClick={() => void signOutOthers()} disabled={revoke.isPending}>
            Sign out all others
          </Button>
        )
      }
    >
      {sessions.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : sessions.isError ? (
        <FormError message={errorMessage(sessions.error)} />
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {sessions.data.map((session) => (
            <li key={session.id} className="flex items-center gap-3 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-fg-2 [&_svg]:size-[1.125rem]">
                {deviceIcon(session.deviceLabel)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate font-medium">{session.deviceLabel}</span>
                  {session.current && <Badge tone="ok">This device</Badge>}
                </div>
                <div className="truncate text-xs text-fg-3">
                  {session.ip && <>{session.ip} · </>}
                  <span title={formatDateTime(session.lastSeenAt)}>
                    {session.current
                      ? 'Active now'
                      : `Active ${formatRelative(session.lastSeenAt)}`}
                  </span>
                  {' · '}
                  signed in {formatRelative(session.createdAt)}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => signOut(session)}
                aria-label={
                  session.current ? 'Log out on this device' : `Sign out ${session.deviceLabel}`
                }
              >
                <LogOut />
                <span className="hidden tablet:inline">
                  {session.current ? 'Log out' : 'Sign out'}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
