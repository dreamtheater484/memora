import { PASSWORD_MIN_LENGTH } from '@memora/shared';
import { useNavigate } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Field, Input, Kbd, PasswordInput, toast } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { AuthLayout, FormError } from './AuthLayout';
import { useSetup } from './queries';

/**
 * First-run setup (§9.1): creates the administrator. The setup code from the server log proves
 * that whoever does this also runs the server, so nobody else on the network can get there first.
 */
export function SetupPage() {
  const navigate = useNavigate();
  const setup = useSetup();
  const [form, setForm] = useState({ setupCode: '', displayName: '', username: '', password: '' });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const error = setup.error instanceof ApiRequestError ? setup.error : undefined;
  const fields = error?.fields ?? {};
  // Field problems are shown next to the fields; the summary covers the rest.
  const summary = setup.error && Object.keys(fields).length === 0 ? setup.error.message : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setup.mutate(form, {
      onSuccess: ({ user }) => {
        toast(`Welcome to Memora, ${user.displayName}.`);
        void navigate({ to: '/', replace: true });
      },
    });
  };

  return (
    <AuthLayout
      title="Set up Memora"
      description="Create the administrator account. You can add more people afterwards."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field
          label="Setup code"
          error={fields.setupCode}
          hint={
            <>
              Printed in the server log when Memora starts, for example with{' '}
              <Kbd>docker logs memora</Kbd>.
            </>
          }
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.setupCode}
              onChange={set('setupCode')}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              className="font-mono tracking-wider uppercase"
              wrapperClassName="h-10"
            />
          )}
        </Field>
        <Field label="Your name" error={fields.displayName}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.displayName}
              onChange={set('displayName')}
              autoComplete="name"
              wrapperClassName="h-10"
            />
          )}
        </Field>
        <Field
          label="Username"
          error={fields.username}
          hint="Letters, digits, dots and dashes. Used to log in."
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.username}
              onChange={set('username')}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              wrapperClassName="h-10"
            />
          )}
        </Field>
        <Field
          label="Password"
          error={fields.password}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.`}
        >
          {({ id, describedBy, invalid }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={form.password}
              onChange={set('password')}
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
          disabled={setup.isPending}
          className="mt-1"
        >
          <Sparkles />
          {setup.isPending ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
