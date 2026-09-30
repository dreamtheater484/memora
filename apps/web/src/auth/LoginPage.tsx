import type { CurrentUser } from '@memora/shared';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Field, Input, PasswordInput } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { safeRedirect } from '../lib/redirect';
import { AuthLayout, FormError } from './AuthLayout';
import { useLogin, useLoginWithCode } from './queries';
import { CodeField } from './TwoFactor';

export function LoginPage() {
  const redirect = safeRedirect(useSearch({ from: '/login' }).redirect);
  const navigate = useNavigate();
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  /** The password was right; the code comes next. */
  const [ticket, setTicket] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const signedIn = (user: CurrentUser) => {
    if (user.mustChangePassword) void navigate({ to: '/change-password', replace: true });
    else if (user.mustSetUpTwoFactor) void navigate({ to: '/set-up-two-factor', replace: true });
    // `href`, not `to`: the page may have had a query string.
    else void navigate({ href: redirect ?? '/', replace: true });
  };

  const error = login.error;
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setExpired(false);
    login.mutate(
      { username, password, remember },
      {
        onSuccess: (response) => {
          setPassword('');
          if ('user' in response) signedIn(response.user);
          else setTicket(response.ticket);
        },
        onError: () => setPassword(''),
      },
    );
  };

  if (ticket) {
    return (
      <CodeStep
        ticket={ticket}
        onSignedIn={signedIn}
        onExpired={() => {
          login.reset();
          setTicket(null);
          setExpired(true);
        }}
      />
    );
  }

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
        <FormError
          message={
            expired
              ? 'That took too long. Log in again.'
              : error instanceof ApiRequestError
                ? error.message
                : error?.message
          }
        />
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

/** The second step: a code from the authenticator app, or a recovery code. */
function CodeStep({
  ticket,
  onSignedIn,
  onExpired,
}: {
  ticket: string;
  onSignedIn: (user: CurrentUser) => void;
  onExpired: () => void;
}) {
  const login = useLoginWithCode();
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const error = login.error instanceof ApiRequestError ? login.error : undefined;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate(
      { ticket, code: recovery ? code.trim() : code.replace(/\s/g, '') },
      {
        onSuccess: ({ user }) => onSignedIn(user),
        onError: (failure) => {
          if (failure instanceof ApiRequestError && failure.code === 'login_expired') onExpired();
          else setCode('');
        },
      },
    );
  };

  return (
    <AuthLayout
      title="Two-step verification"
      description={
        recovery
          ? 'Enter one of your recovery codes. Each works once.'
          : 'Enter the code from your authenticator app.'
      }
      footer={
        <button
          type="button"
          className="underline underline-offset-2 hover:text-fg"
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
            login.reset();
          }}
        >
          {recovery ? 'Use the authenticator app' : 'Lost your phone? Use a recovery code'}
        </button>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <CodeField
          key={recovery ? 'recovery' : 'app'}
          value={code}
          onChange={setCode}
          recovery={recovery}
          error={error?.fields.code}
          autoFocus
        />
        <FormError
          message={error && Object.keys(error.fields).length === 0 ? error.message : undefined}
        />
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={login.isPending || !code.trim()}
          className="mt-1"
        >
          <LogIn />
          {login.isPending ? 'Checking…' : 'Log in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
