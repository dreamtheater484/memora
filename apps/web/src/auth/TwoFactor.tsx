import type { TwoFactorSetup as Setup } from '@memora/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Checkbox, Field, Input, PasswordInput, toast } from '../components/ui';
import { ApiRequestError, errorMessage } from '../lib/api';
import { FormError } from './AuthLayout';
import { QrCode } from './QrCode';
import { twoFactorDone, useEnableTwoFactor, useStartTwoFactor } from './queries';

/*
 * Two-step verification (§11, Phase 12): setting it up (the password again, a QR code for the
 * authenticator app, a first code) and the recovery codes. Used by the Account page and by
 * the set-up an administrator can require.
 */

const fieldsOf = (error: unknown): Record<string, string> =>
  error instanceof ApiRequestError ? error.fields : {};

/** A form's message when no field has one. */
const summaryOf = (error: unknown) =>
  error && Object.keys(fieldsOf(error)).length === 0 ? errorMessage(error) : undefined;

/** The field for a code from the authenticator app (or, with `recovery`, a recovery code). */
export function CodeField({
  value,
  onChange,
  error,
  recovery = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  recovery?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Field
      label={recovery ? 'Recovery code' : 'Code from the app'}
      error={error}
      hint={recovery ? 'One of the codes you saved, like 7kq2-mx9d-4hwn.' : 'Six digits.'}
    >
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          aria-describedby={describedBy}
          invalid={invalid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...(recovery
            ? { autoComplete: 'off', autoCapitalize: 'none' }
            : { autoComplete: 'one-time-code', inputMode: 'numeric' as const, maxLength: 7 })}
          spellCheck={false}
          autoFocus={autoFocus}
          className="font-mono tracking-wider"
          wrapperClassName="h-10"
        />
      )}
    </Field>
  );
}

/** The password again, before anything about two-step verification changes. */
export function PasswordStep({
  username,
  pending,
  error,
  action,
  onSubmit,
}: {
  username: string;
  pending: boolean;
  error: unknown;
  action: string;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(password);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <input type="hidden" autoComplete="username" value={username} readOnly />
      <Field label="Your password" error={fieldsOf(error).password}>
        {({ id, describedBy, invalid }) => (
          <PasswordInput
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            wrapperClassName="h-10"
          />
        )}
      </Field>
      <FormError message={summaryOf(error)} />
      <Button type="submit" variant="primary" disabled={pending || !password}>
        {action}
      </Button>
    </form>
  );
}

/** Recovery codes, to copy or download; each works once. */
export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = `Memora recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast('Copying isn’t allowed here. Download them instead.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'memora-recovery-codes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="flex flex-col gap-3">
      <ul
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-line bg-surface px-4 py-3 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {'clipboard' in navigator && (
          <Button onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        )}
        <Button onClick={download}>
          <Download />
          Download
        </Button>
      </div>
    </div>
  );
}

/** The codes are shown once: the user says they have them before going on. */
export function SaveCodesStep({
  codes,
  onDone,
  done = 'Done',
}: {
  codes: string[];
  onDone: () => void;
  done?: string;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-fg-2">
        If you lose your phone, each of these codes lets you log in once. Keep them somewhere safe,
        such as a password manager. They won’t be shown again.
      </p>
      <RecoveryCodes codes={codes} />
      <label className="flex items-center gap-2.5 text-sm text-fg-2 select-none">
        <Checkbox checked={saved} onCheckedChange={(v) => setSaved(v === true)} />
        I’ve saved my recovery codes
      </label>
      <Button variant="primary" disabled={!saved} onClick={onDone}>
        {done}
      </Button>
    </div>
  );
}

const groups = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ');

/** From the password to the recovery codes. */
export function TwoFactorSetup({
  username,
  onDone,
  done,
}: {
  username: string;
  onDone: () => void;
  done?: string;
}) {
  const queryClient = useQueryClient();
  const start = useStartTwoFactor();
  const enable = useEnableTwoFactor();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState('');

  if (enable.data) {
    return (
      <SaveCodesStep
        codes={enable.data.codes}
        done={done}
        onDone={() => {
          twoFactorDone(queryClient);
          toast('Two-step verification is on.');
          onDone();
        }}
      />
    );
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-2">
          You’ll need an authenticator app on your phone, such as 2FAS, Aegis, Google Authenticator
          or the one in your password manager.
        </p>
        <PasswordStep
          username={username}
          pending={start.isPending}
          error={start.error}
          action="Continue"
          onSubmit={(password) => start.mutate(password, { onSuccess: setSetup })}
        />
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    enable.mutate(code.replace(/\s/g, ''));
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-fg-2">
        <li>
          Scan this code with your authenticator app.
          <div className="mt-3 flex justify-center">
            <QrCode text={setup.uri} label="QR code for your authenticator app" />
          </div>
          <p className="mt-3">Can’t scan it? Enter this key instead:</p>
          <code className="mt-1.5 block w-fit rounded-sm bg-surface px-2 py-1 font-mono text-fg">
            {groups(setup.secret)}
          </code>
        </li>
        <li>Enter the code the app shows for Memora.</li>
      </ol>
      <CodeField value={code} onChange={setCode} error={fieldsOf(enable.error).code} />
      <FormError message={summaryOf(enable.error)} />
      <Button type="submit" variant="primary" disabled={enable.isPending || !code.trim()}>
        <ShieldCheck />
        Turn on
      </Button>
    </form>
  );
}
