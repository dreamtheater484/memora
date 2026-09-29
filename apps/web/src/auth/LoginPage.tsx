import { useNavigate, useSearch } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Field, Input, PasswordInput } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { safeRedirect } from '../lib/redirect';
import { AuthLayout, FormError } from './AuthLayout';
import { useLogin } from './queries';

export function LoginPage() {
  const redirect = safeRedirect(useSearch({ from: '/login' }).redirect);
  const navigate = useNavigate();
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);

  const error = login.error;
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate(
      { username, password, remember },
      {
        onSuccess: ({ user }) => {
          if (user.mustChangePassword) void navigate({ to: '/change-password', replace: true });
          // `href`, not `to`: the page may have had a query string.
          else void navigate({ href: redirect ?? '/', replace: true });
        },
        onError: () => setPassword(''),
      },
    );
  };

  return (
    <AuthLayout
      title="Welcome back"
      description="Log in to your notes."
      footer="Forgot your password? Ask your Memora administrator to reset it."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label="Username">
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
              wrapperClassName="h-10"
            />
          )}
        </Field>
        <Field label="Password">
          {({ id, describedBy }) => (
            <PasswordInput
              id={id}
              aria-describedby={describedBy}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              wrapperClassName="h-10"
            />
          )}
        </Field>
        <label className="flex items-center gap-2.5 text-sm text-fg-2 select-none">
          <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
          Remember this device for 30 days
        </label>
        <FormError message={error instanceof ApiRequestError ? error.message : error?.message} />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={login.isPending || !username || !password}
          className="mt-1"
        >
          <LogIn />
          {login.isPending ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
