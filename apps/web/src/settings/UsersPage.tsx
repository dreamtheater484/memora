import type { AdminUser, Role, TemporaryPasswordResponse } from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import {
  Ban,
  Check,
  CircleCheck,
  Copy,
  Ellipsis,
  KeyRound,
  Pencil,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { FormError } from '../auth/AuthLayout';
import {
  useCreateUser,
  useCurrentUser,
  useDeleteUser,
  useResetPassword,
  useUpdateUser,
  usersQuery,
} from '../auth/queries';
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  Field,
  IconButton,
  Input,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  Skeleton,
  toast,
} from '../components/ui';
import { ApiRequestError, errorMessage } from '../lib/api';
import { formatDateTime, formatRelative } from '../lib/time';
import { SettingsSection } from './SettingsLayout';

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Administrator' },
];

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; user: AdminUser }
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'disable'; user: AdminUser }
  | { kind: 'delete'; user: AdminUser }
  | { kind: 'password'; result: TemporaryPasswordResponse; created: boolean }
  | null;

export function UsersPage() {
  const me = useCurrentUser();
  const users = useQuery(usersQuery);
  const update = useUpdateUser();
  const [dialog, setDialog] = useState<DialogState>(null);
  const close = () => setDialog(null);

  const enable = (user: AdminUser) =>
    update.mutate(
      { id: user.id, disabled: false },
      {
        onSuccess: () => toast(`${user.displayName} can log in again.`),
        onError: (error) => toast(errorMessage(error)),
      },
    );

  return (
    <SettingsSection
      title="Users"
      description="Everyone who can log in to this Memora. Each person’s notes are private to them."
      actions={
        <Button variant="primary" size="sm" onClick={() => setDialog({ kind: 'create' })}>
          <UserPlus />
          Add user
        </Button>
      }
    >
      {users.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : users.isError ? (
        <FormError message={errorMessage(users.error)} />
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {users.data.map((user) => {
            const self = user.id === me.id;
            return (
              <li key={user.id} className="flex items-center gap-3 py-3">
                <Avatar
                  name={user.displayName}
                  decorative
                  className={user.disabled ? 'opacity-40' : undefined}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-medium">{user.displayName}</span>
                    {self && <Badge tone="neutral">You</Badge>}
                    {user.role === 'admin' && <Badge tone="accent">Administrator</Badge>}
                    {user.disabled && <Badge tone="danger">Disabled</Badge>}
                    {!user.disabled && user.mustChangePassword && (
                      <Badge tone="warn">One-time password</Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-fg-3">
                    @{user.username} ·{' '}
                    {user.lastSeenAt ? (
                      <span title={formatDateTime(user.lastSeenAt)}>
                        active {formatRelative(user.lastSeenAt)}
                      </span>
                    ) : (
                      'not signed in'
                    )}
                  </div>
                </div>
                <Menu>
                  <MenuTrigger asChild>
                    <IconButton
                      label={`Actions for ${user.displayName}`}
                      icon={<Ellipsis />}
                      size="sm"
                    />
                  </MenuTrigger>
                  <MenuContent align="end">
                    <MenuItem icon={<Pencil />} onSelect={() => setDialog({ kind: 'edit', user })}>
                      Edit
                    </MenuItem>
                    {!self && (
                      <MenuItem
                        icon={<KeyRound />}
                        onSelect={() => setDialog({ kind: 'reset', user })}
                      >
                        Reset password…
                      </MenuItem>
                    )}
                    {!self &&
                      (user.disabled ? (
                        <MenuItem icon={<CircleCheck />} onSelect={() => enable(user)}>
                          Enable
                        </MenuItem>
                      ) : (
                        <MenuItem
                          icon={<Ban />}
                          onSelect={() => setDialog({ kind: 'disable', user })}
                        >
                          Disable…
                        </MenuItem>
                      ))}
                    {!self && (
                      <>
                        <MenuSeparator />
                        <MenuItem
                          icon={<Trash2 />}
                          danger
                          onSelect={() => setDialog({ kind: 'delete', user })}
                        >
                          Delete…
                        </MenuItem>
                      </>
                    )}
                  </MenuContent>
                </Menu>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && close()}>
        {dialog?.kind === 'create' && (
          <UserFormDialog
            onDone={(result) => setDialog({ kind: 'password', result, created: true })}
          />
        )}
        {dialog?.kind === 'edit' && (
          <UserFormDialog user={dialog.user} self={dialog.user.id === me.id} onDone={close} />
        )}
        {dialog?.kind === 'reset' && (
          <ResetDialog
            user={dialog.user}
            onDone={(result) => setDialog({ kind: 'password', result, created: false })}
          />
        )}
        {dialog?.kind === 'disable' && <DisableDialog user={dialog.user} onDone={close} />}
        {dialog?.kind === 'delete' && <DeleteDialog user={dialog.user} onDone={close} />}
        {dialog?.kind === 'password' && (
          <TemporaryPasswordDialog result={dialog.result} created={dialog.created} />
        )}
      </Dialog>
    </SettingsSection>
  );
}

function UserFormDialog({
  user,
  self,
  onDone,
}: {
  user?: AdminUser;
  self?: boolean;
  onDone: (result: TemporaryPasswordResponse) => void;
}) {
  const create = useCreateUser();
  const update = useUpdateUser();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [role, setRole] = useState<Role>(user?.role ?? 'user');
  const mutation = user ? update : create;
  const fields = mutation.error instanceof ApiRequestError ? mutation.error.fields : {};
  const summary =
    mutation.error && Object.keys(fields).length === 0 ? errorMessage(mutation.error) : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (user) {
      update.mutate(
        { id: user.id, displayName, ...(self ? {} : { role }) },
        {
          onSuccess: () => {
            toast('Changes saved.');
            onDone({ user, temporaryPassword: '' });
          },
        },
      );
    } else {
      create.mutate({ username, displayName, role }, { onSuccess: onDone });
    }
  };

  const formId = user ? 'edit-user' : 'create-user';
  return (
    <DialogContent
      title={user ? `Edit ${user.displayName}` : 'Add a user'}
      description={
        user
          ? undefined
          : 'They get a one-time password to log in with, and choose their own afterwards.'
      }
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button type="submit" form={formId} variant="primary" disabled={mutation.isPending}>
            {user ? 'Save' : 'Add user'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {!user && (
          <Field
            label="Username"
            error={fields.username}
            hint="Used to log in. Can’t be changed later."
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
                autoComplete="off"
                autoFocus
              />
            )}
          </Field>
        )}
        <Field label="Name" error={fields.displayName}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="off"
              autoFocus={!!user}
            />
          )}
        </Field>
        {!self && (
          <Field
            label="Role"
            hint="Administrators can manage users and see the audit log. They can’t read other people’s notes."
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={role}
                onValueChange={(value) => setRole(value as Role)}
                options={ROLE_OPTIONS}
              />
            )}
          </Field>
        )}
        <FormError message={summary} />
      </form>
    </DialogContent>
  );
}

function ResetDialog({
  user,
  onDone,
}: {
  user: AdminUser;
  onDone: (result: TemporaryPasswordResponse) => void;
}) {
  const reset = useResetPassword();
  return (
    <DialogContent
      title={`Reset ${user.displayName}’s password?`}
      description="They’re signed out everywhere and get a one-time password to log in with."
      size="sm"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={reset.isPending}
            onClick={() => reset.mutate(user.id, { onSuccess: onDone })}
          >
            Reset password
          </Button>
        </>
      }
    >
      <FormError message={reset.error ? errorMessage(reset.error) : undefined} />
    </DialogContent>
  );
}

function DisableDialog({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const update = useUpdateUser();
  return (
    <DialogContent
      title={`Disable ${user.displayName}?`}
      description="They’re signed out everywhere and can’t log in until you enable the account again. Their notes are kept."
      size="sm"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { id: user.id, disabled: true },
                {
                  onSuccess: () => {
                    toast(`${user.displayName} is disabled.`);
                    onDone();
                  },
                },
              )
            }
          >
            Disable
          </Button>
        </>
      }
    >
      <FormError message={update.error ? errorMessage(update.error) : undefined} />
    </DialogContent>
  );
}

function DeleteDialog({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const remove = useDeleteUser();
  const [confirm, setConfirm] = useState('');
  const matches = confirm.trim().toLowerCase() === user.username;
  return (
    <DialogContent
      title={`Delete ${user.displayName}?`}
      description="This deletes the account and all of its notes, boards and files. It can’t be undone."
      size="sm"
      footer={
        <>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            disabled={!matches || remove.isPending}
            onClick={() =>
              remove.mutate(user.id, {
                onSuccess: () => {
                  toast(`${user.displayName} was deleted.`);
                  onDone();
                },
              })
            }
          >
            Delete for good
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={`Type ${user.username} to confirm`}>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
          )}
        </Field>
        <FormError message={remove.error ? errorMessage(remove.error) : undefined} />
      </div>
    </DialogContent>
  );
}

function TemporaryPasswordDialog({
  result,
  created,
}: {
  result: TemporaryPasswordResponse;
  created: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
    } catch {
      toast('Couldn’t copy. Select the password and copy it yourself.');
    }
  };
  return (
    <DialogContent
      title={created ? `${result.user.displayName} was added` : 'Password reset'}
      description={`Give ${result.user.displayName} this one-time password. They choose their own when they log in with username “${result.user.username}”.`}
      size="sm"
      // Shown once: a stray click beside the dialog mustn't lose it.
      onInteractOutside={(event) => event.preventDefault()}
      footer={
        <DialogClose asChild>
          <Button variant="primary">Done</Button>
        </DialogClose>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface py-2 pr-2 pl-3.5">
          <output
            aria-label="One-time password"
            className="min-w-0 flex-1 truncate font-mono text-lg tracking-wide select-all"
          >
            {result.temporaryPassword}
          </output>
          <Button size="sm" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-xs text-fg-3">
          It won’t be shown again. Share it in person or over a private channel.
        </p>
      </div>
    </DialogContent>
  );
}
