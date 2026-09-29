import { PASSWORD_MIN_LENGTH } from '@memora/shared';
import { useNavigate } from '@tanstack/react-router';
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Field, PasswordInput, toast } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { AuthLayout, FormError } from './AuthLayout';
import { useChangePassword, useCurrentUser, useLogout } from './queries';

/** Shown after logging in with a one-time password from an administrator. */
export function ChangePasswordPage() {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const change = useChangePassword();
  const logout = useLogout();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const error = change.error instanceof ApiRequestError ? change.error : undefined;
  const fields = error?.fields ?? {};
  const summary =
    change.error && Object.keys(fields).length === 0 ? change.error.message : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          toast('Your new password is set.');
          void navigate({ to: '/', replace: true });
        },
      },
    );
  };

  return (
    <AuthLayout
      title="Choose your password"
      description={
        <>
          Hi {user.displayName}. You logged in with a one-time password; choose your own to
          continue.
        </>
      }
      footer={
        <button
          type="button"
          className="underline underline-offset-2 hover:text-fg"
          onClick={() => logout.mutate()}
        >
          Log out instead
        </button>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {/* Lets password managers save the new password under the right account. */}
        <input type="hidden" autoComplete="username" value={user.username} readOnly />
        <Field
          label="One-time password"
          error={
            error?.code === 'wrong_password'
              ? 'That’s not the one-time password you logged in with.'
              : fields.currentPassword
          }
        >
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
              wrapperClassName="h-10"
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
              wrapperClassName="h-10"
            />
          )}
        </Field>
        <FormError message={summary} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={change.isPending || !currentPassword || !newPassword}
          className="mt-1"
        >
          <KeyRound />
          {change.isPending ? 'Saving…' : 'Set password and continue'}
        </Button>
      </form>
    </AuthLayout>
  );
}
