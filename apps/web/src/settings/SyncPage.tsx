import {
  SYNC_PASSPHRASE_MIN,
  type ConnectSyncRequest,
  type SyncConnected,
  type SyncPauseReason,
  type SyncProvider,
  type SyncStatus,
} from '@memora/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  CircleCheck,
  CirclePause,
  FolderOpen,
  HardDrive,
  KeyRound,
  Laptop,
  LoaderCircle,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FormError } from '../auth/AuthLayout';
import { HelpLink } from '../components/HelpLink';
import {
  Button,
  DialogContent,
  Dialog,
  Field,
  Input,
  PasswordInput,
  Skeleton,
  toast,
} from '../components/ui';
import { api, ApiRequestError, errorMessage } from '../lib/api';
import { cn } from '../lib/cn';
import { HELP } from '../lib/help';
import { formatDateTime, formatRelative } from '../lib/time';
import { cloudSyncKey, cloudSyncQuery } from './cloudSync';
import { SettingsSection } from './SettingsLayout';

/*
 * Settings → Sync (ADR 0006): the desktop app keeps its notes the same on several computers
 * through one folder in the cloud, end-to-end encrypted. Choosing the folder, the passphrase,
 * how sync is doing, and turning it off.
 */

interface ProviderInfo {
  id: SyncProvider;
  name: string;
  icon: ReactNode;
  line: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'google',
    name: 'Google Drive',
    icon: <HardDrive />,
    line: 'Memora makes one folder and sees nothing else in your Drive: Google enforces that.',
  },
  {
    id: 'kdrive',
    name: 'Infomaniak kDrive',
    icon: <Server />,
    line: 'Through WebDAV, with an application password made just for Memora.',
  },
  {
    id: 'webdav',
    name: 'Nextcloud or another WebDAV server',
    icon: <Server />,
    line: 'Any WebDAV folder over HTTPS, with an app password.',
  },
  {
    id: 'folder',
    name: 'A folder on this computer',
    icon: <FolderOpen />,
    line: 'One that the Google Drive, kDrive or Nextcloud app keeps in sync, or a network drive. Memora needs no sign-in.',
  },
];

const providerName = (id: SyncProvider | null) => PROVIDERS.find((p) => p.id === id)?.name ?? '';

/** Field messages from an API error, by field name. */
const fieldsOf = (error: unknown): Record<string, string> => {
  if (!(error instanceof ApiRequestError)) return {};
  const details = error.details as { fields?: Record<string, string> } | undefined;
  return { ...(details?.fields ?? {}), ...error.fields };
};

function useSetStatus() {
  const queryClient = useQueryClient();
  return (status: SyncStatus) => queryClient.setQueryData(cloudSyncKey, status);
}

export function SyncPage() {
  const query = useQuery({
    ...cloudSyncQuery,
    // Events keep it current while the notes are open; this page also looks by itself (often
    // while Google's sign-in is open in the browser or a run goes on).
    refetchInterval: (q) =>
      q.state.data?.pending?.signIn === 'waiting' || q.state.data?.running
        ? 2000
        : q.state.data?.state === 'on' || q.state.data?.state === 'connecting'
          ? 10_000
          : false,
  });
  const status = query.data;
  if (!status) {
    return (
      <SettingsSection title="Sync">
        {query.isError ? (
          <FormError message={errorMessage(query.error)} />
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </SettingsSection>
    );
  }
  if (!status.available) {
    return (
      <SettingsSection title="Sync">
        <p className="text-sm text-fg-2">
          Sync through a cloud folder is part of Memora for your computer. Memora Server keeps every
          device in sync by itself.
        </p>
      </SettingsSection>
    );
  }
  return (
    <>
      {status.state === 'off' && <Setup status={status} />}
      {status.state === 'connecting' && <Connecting status={status} />}
      {(status.state === 'on' || status.state === 'paused') && <Synced status={status} />}
      {status.state !== 'on' && status.state !== 'paused' && <OwnGoogleClient status={status} />}
    </>
  );
}

// Setting up: where

function Setup({ status }: { status: SyncStatus }) {
  // Google Drive first, when this build can sign in to it.
  const [provider, setProvider] = useState<SyncProvider>(
    status.google.available ? 'google' : 'folder',
  );
  return (
    <SettingsSection
      title="Sync your computers"
      description={
        <>
          Keep your notes the same on all your computers, through a folder in your cloud storage.{' '}
          <HelpLink href={HELP.sync}>How it works</HelpLink>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <ul className="flex flex-col gap-2 text-sm text-fg-2">
          <Point icon={<ShieldCheck />}>
            Everything is encrypted on this computer, with a passphrase only you know, before it
            reaches the cloud. Nobody else can read it, your cloud provider included.
          </Point>
          <Point icon={<FolderOpen />}>
            Memora uses one folder and nothing else in your storage, and reads and writes only
            there.
          </Point>
          <Point icon={<Laptop />}>
            For your computers (Windows, macOS, Ubuntu). For phones, use Memora Server.
          </Point>
        </ul>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">Where should Memora sync?</legend>
          {PROVIDERS.map((p) => (
            <label
              key={p.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3.5 py-3 transition-colors hover:bg-hover',
                'has-checked:border-accent has-checked:bg-accent-soft',
              )}
            >
              <input
                type="radio"
                name="provider"
                value={p.id}
                checked={provider === p.id}
                onChange={() => setProvider(p.id)}
                aria-label={p.name}
                className="mt-1 accent-(--accent)"
              />
              <span className="mt-0.5 text-fg-2 [&_svg]:size-4">{p.icon}</span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{p.name}</span>
                <span className="text-xs text-fg-2">{p.line}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {!status.secureStorage && provider !== 'folder' && (
          <FormError message="This computer can’t keep a sign-in safely: it has no keyring (on Linux, install and unlock GNOME Keyring or KWallet). A folder on this computer works without one." />
        )}
        {provider === 'google' && <GoogleForm status={status} />}
        {provider === 'kdrive' && <KDriveForm />}
        {provider === 'webdav' && <WebDavForm />}
        {provider === 'folder' && <FolderForm />}
      </div>
    </SettingsSection>
  );
}

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-2.5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-accent">
      {icon}
      <span>{children}</span>
    </li>
  );
}

/** Reaching the folder: the server checks it may read and write there. */
function useConnect() {
  const setStatus = useSetStatus();
  return useMutation({
    mutationFn: (body: ConnectSyncRequest) => api<SyncConnected>('POST', '/sync/connect', body),
    onSuccess: async () => setStatus(await api<SyncStatus>('GET', '/sync')),
  });
}

function GoogleForm({ status }: { status: SyncStatus }) {
  const setStatus = useSetStatus();
  const [folder, setFolder] = useState('Memora');
  const start = useMutation({
    mutationFn: () => api<{ url: string }>('POST', '/sync/google/start'),
    onSuccess: async ({ url }) => {
      // The desktop app opens it in the computer's own browser.
      window.open(url, '_blank', 'noopener,noreferrer');
      sessionStorage.setItem('memora-sync-folder', folder);
      setStatus(await api<SyncStatus>('GET', '/sync'));
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <Field label="Folder in My Drive" hint="Memora makes it, or finds the one it made before.">
        {(ids) => (
          <Input
            id={ids.id}
            aria-describedby={ids.describedBy}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            wrapperClassName="max-w-xs"
          />
        )}
      </Field>
      {!status.google.available && (
        <p className="text-sm text-fg-2">
          This build of Memora can’t sign in to Google Drive. Add a Google Cloud client of your own
          below, or choose “A folder on this computer” with the Google Drive app.
        </p>
      )}
      <FormError message={start.isError ? errorMessage(start.error) : undefined} />
      <div>
        <Button
          variant="primary"
          disabled={!status.google.available || start.isPending || !folder.trim()}
          onClick={() => start.mutate()}
        >
          Sign in with Google
        </Button>
      </div>
      <p className="text-xs text-fg-3">
        Google asks whether Memora may “see, edit, create and delete only the specific Google Drive
        files you use with this app”. That is all Memora asks for.
      </p>
    </div>
  );
}

function KDriveForm() {
  const connect = useConnect();
  const [form, setForm] = useState({ driveId: '', username: '', password: '', folder: 'Memora' });
  const errors = fieldsOf(connect.error);
  const set = (name: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [name]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate({ provider: 'kdrive', ...form });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="kDrive ID"
        hint="The number in kDrive’s address in your browser: …/kdrive/app/drive/123456."
        error={errors.driveId}
      >
        {(ids) => (
          <Input
            id={ids.id}
            aria-describedby={ids.describedBy}
            invalid={ids.invalid}
            inputMode="numeric"
            value={form.driveId}
            onChange={set('driveId')}
            wrapperClassName="max-w-48"
          />
        )}
      </Field>
      <Field
        label="E-mail address"
        hint="The one you sign in to Infomaniak with."
        error={errors.username}
      >
        {(ids) => (
          <Input
            id={ids.id}
            aria-describedby={ids.describedBy}
            invalid={ids.invalid}
            type="email"
            autoComplete="username"
            value={form.username}
            onChange={set('username')}
          />
        )}
      </Field>
      <Field
        label="Application password"
        hint={
          <>
            Make one just for Memora: Infomaniak Manager → your profile → Security → Application
            passwords. You can revoke it there at any time. kDrive can’t limit a password to one
            folder, so Memora keeps to its folder itself.
          </>
        }
        error={errors.password}
      >
        {(ids) => (
          <PasswordInput
            id={ids.id}
            aria-describedby={ids.describedBy}
            invalid={ids.invalid}
            autoComplete="off"
            value={form.password}
            onChange={set('password')}
          />
        )}
      </Field>
      <Field
        label="Folder"
        hint="In your kDrive; Memora makes it if it isn’t there."
        error={errors.folder}
      >
        {(ids) => (
          <Input
            id={ids.id}
            aria-describedby={ids.describedBy}
            invalid={ids.invalid}
            value={form.folder}
            onChange={set('folder')}
            wrapperClassName="max-w-xs"
          />
        )}
      </Field>
      <FormError
        message={
          connect.isError && !Object.keys(errors).length ? errorMessage(connect.error) : undefined
        }
      />
      <div>
        <Button type="submit" variant="primary" disabled={connect.isPending}>
          {connect.isPending ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </form>
  );
}

function WebDavForm() {
  const connect = useConnect();
  const [form, setForm] = useState({ url: '', username: '', password: '' });
  const errors = fieldsOf(connect.error);
  const set = (name: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [name]: e.target.value }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate({ provider: 'webdav', ...form });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="Folder address"
        hint="For Nextcloud: https://your-cloud/remote.php/dav/files/your-name/Memora. Memora makes the last folder if it isn’t there."
        error={errors.url}
      >
        {(ids) => (
          <Input
            id={ids.id}
            aria-describedby={ids.describedBy}
            invalid={ids.invalid}
            type="url"
            placeholder="https://"
            value={form.url}
            onChange={set('url')}
          />
        )}
      </Field>
      <Field label="User name" error={errors.username}>
        {(ids) => (
          <Input
            id={ids.id}
            aria-describedby={ids.describedBy}
            invalid={ids.invalid}
            autoComplete="username"
            value={form.username}
            onChange={set('username')}
          />
        )}
      </Field>
      <Field
        label="App password"
        hint="Make one just for Memora in your cloud’s security settings. Memora keeps to the folder; the password itself opens your account."
        error={errors.password}
      >
        {(ids) => (
          <PasswordInput
            id={ids.id}
            aria-describedby={ids.describedBy}
            invalid={ids.invalid}
            autoComplete="off"
            value={form.password}
            onChange={set('password')}
          />
        )}
      </Field>
      <FormError
        message={
          connect.isError && !Object.keys(errors).length ? errorMessage(connect.error) : undefined
        }
      />
      <div>
        <Button type="submit" variant="primary" disabled={connect.isPending}>
          {connect.isPending ? 'Connecting…' : 'Connect'}
        </Button>
      </div>
    </form>
  );
}

function FolderForm() {
  const connect = useConnect();
  const [path, setPath] = useState('');
  const errors = fieldsOf(connect.error);
  const pick = useMutation({
    mutationFn: () => api<{ path: string | null }>('POST', '/sync/pick-folder'),
    onSuccess: ({ path: picked }) => {
      if (picked) setPath(picked);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    connect.mutate({ provider: 'folder', path });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        label="Folder"
        hint="Choose an empty folder, or the one your other computers sync through."
        error={errors.path}
      >
        {(ids) => (
          <div className="flex gap-2">
            <Input
              id={ids.id}
              aria-describedby={ids.describedBy}
              invalid={ids.invalid}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              wrapperClassName="flex-1"
            />
            <Button type="button" onClick={() => pick.mutate()} disabled={pick.isPending}>
              Choose…
            </Button>
          </div>
        )}
      </Field>
      <FormError
        message={
          connect.isError && !Object.keys(errors).length ? errorMessage(connect.error) : undefined
        }
      />
      <div>
        <Button type="submit" variant="primary" disabled={connect.isPending || !path.trim()}>
          {connect.isPending ? 'Checking the folder…' : 'Use this folder'}
        </Button>
      </div>
    </form>
  );
}

// Setting up: the passphrase

function Connecting({ status }: { status: SyncStatus }) {
  const setStatus = useSetStatus();
  const pending = status.pending!;
  const cancel = useMutation({
    mutationFn: () => api<SyncStatus>('POST', '/sync/cancel'),
    onSuccess: setStatus,
  });
  const connect = useConnect();
  const asked = useRef(false);
  // Google: signed in in the browser, so the folder can be looked at now.
  useEffect(() => {
    if (
      pending.provider !== 'google' ||
      pending.signIn !== 'done' ||
      pending.vault ||
      asked.current
    ) {
      return;
    }
    asked.current = true;
    connect.mutate({
      provider: 'google',
      folder: sessionStorage.getItem('memora-sync-folder') || 'Memora',
    });
  }, [pending, connect]);

  const footer = (
    <div className="mt-2 flex gap-2">
      <Button onClick={() => cancel.mutate()} disabled={cancel.isPending}>
        Cancel
      </Button>
    </div>
  );

  if (!pending.vault) {
    return (
      <SettingsSection title="Sign in to Google Drive" description={providerName(pending.provider)}>
        <div className="flex flex-col gap-3 text-sm">
          {pending.signIn === 'failed' ? (
            <FormError message={pending.signInError ?? 'Google didn’t sign Memora in.'} />
          ) : connect.isError ? (
            <FormError message={errorMessage(connect.error)} />
          ) : (
            <p className="flex items-center gap-2 text-fg-2">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              {pending.signIn === 'done'
                ? 'Signed in. Looking at the folder…'
                : 'Finish signing in in your browser, then come back here.'}
            </p>
          )}
          {footer}
        </div>
      </SettingsSection>
    );
  }
  return <Passphrase status={status} onCancel={() => cancel.mutate()} />;
}

function Passphrase({ status, onCancel }: { status: SyncStatus; onCancel: () => void }) {
  const setStatus = useSetStatus();
  const pending = status.pending!;
  const fresh = pending.vault === 'new';
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const enable = useMutation({
    mutationFn: () => api<SyncStatus>('POST', '/sync/enable', { passphrase }),
    onSuccess: (next) => {
      setStatus(next);
      toast({
        title: fresh ? 'Sync is on' : 'Joined: your notes are coming in',
        tone: 'success',
      });
    },
  });
  const errors = fieldsOf(enable.error);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (fresh && passphrase !== again) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    enable.mutate();
  };
  return (
    <SettingsSection
      title={fresh ? 'Choose a passphrase' : 'Enter the passphrase'}
      description={`${providerName(pending.provider)} · ${pending.location ?? ''}`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {fresh ? (
          <div className="flex flex-col gap-2 text-sm text-fg-2">
            <p>
              This folder has no Memora sync yet. The passphrase encrypts your notes before they
              leave this computer. You’ll enter it once on each computer you add.
            </p>
            <p className="flex gap-2 rounded-md bg-warn/10 px-3 py-2.5 text-fg [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-warn">
              <KeyRound aria-hidden />
              <span>
                Keep it somewhere safe, such as a password manager. Without it, the synced copy
                can’t be read by anyone, Memora included. Your notes stay on each computer.
              </span>
            </p>
          </div>
        ) : (
          <p className="text-sm text-fg-2">
            Your other computers sync through this folder. Enter the passphrase you chose for it.
            The notes on this computer are added to theirs.
          </p>
        )}
        <Field
          label="Passphrase"
          hint={
            fresh
              ? `At least ${SYNC_PASSPHRASE_MIN} characters: a few unrelated words work well.`
              : undefined
          }
          error={errors.passphrase}
        >
          {(ids) => (
            <PasswordInput
              id={ids.id}
              aria-describedby={ids.describedBy}
              invalid={ids.invalid}
              autoComplete={fresh ? 'new-password' : 'current-password'}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        {fresh && (
          <Field label="The passphrase again" error={mismatch ? 'The two don’t match.' : undefined}>
            {(ids) => (
              <PasswordInput
                id={ids.id}
                aria-describedby={ids.describedBy}
                invalid={ids.invalid}
                autoComplete="new-password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
              />
            )}
          </Field>
        )}
        <FormError
          message={enable.isError && !errors.passphrase ? errorMessage(enable.error) : undefined}
        />
        <div className="flex gap-2">
          <Button type="button" onClick={onCancel} disabled={enable.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={enable.isPending || !passphrase}>
            {enable.isPending
              ? fresh
                ? 'Setting up…'
                : 'Checking…'
              : fresh
                ? 'Start syncing'
                : 'Join'}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

// Sync is set up

const PAUSED: Record<SyncPauseReason, string> = {
  restored:
    'A backup was restored on this computer, so what sync knew about it is out of date. Sync again: where the notes here and on your other computers differ, theirs win, and the text of pages here is kept in each page’s history.',
  vault_changed:
    'The sync folder changed: it was emptied, moved, or now holds another sync. Check the folder. Syncing again joins what is there now.',
  signed_out: 'The cloud no longer accepts Memora’s sign-in.',
  no_secure_storage: 'This computer can’t keep the sign-in safely any more (its keyring is gone).',
  update_needed: 'Another computer uses a newer Memora. Update Memora on this computer too.',
};

function Synced({ status }: { status: SyncStatus }) {
  const setStatus = useSetStatus();
  const now = useNow();
  const syncNow = useMutation({
    mutationFn: () => api<SyncStatus>('POST', '/sync/now'),
    onSuccess: setStatus,
  });
  const resume = useMutation({
    mutationFn: () => api<SyncStatus>('POST', '/sync/resume'),
    onSuccess: setStatus,
  });
  const [turningOff, setTurningOff] = useState(false);
  const google = status.provider === 'google';
  const dav = status.provider === 'webdav' || status.provider === 'kdrive';

  let state: ReactNode;
  if (status.paused) {
    state = (
      <span className="inline-flex items-center gap-1.5 text-warn">
        <CirclePause aria-hidden className="size-4" />
        Paused
      </span>
    );
  } else if (status.running) {
    state = (
      <span className="inline-flex items-center gap-1.5">
        <LoaderCircle aria-hidden className="size-4 animate-spin text-accent" />
        {status.activity ?? 'Syncing'}…
      </span>
    );
  } else if (status.lastError) {
    state = (
      <span className="inline-flex items-start gap-1.5 text-danger">
        <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Didn’t work {formatRelative(status.lastError.at, now)}: {status.lastError.message} Memora
          tries again by itself.
        </span>
      </span>
    );
  } else if (status.lastSyncAt) {
    state = (
      <span className="inline-flex items-center gap-1.5">
        <CircleCheck aria-hidden className="size-4 text-ok" />
        Synced {formatRelative(status.lastSyncAt, now)}
      </span>
    );
  } else {
    state = <span className="text-fg-2">Starting…</span>;
  }

  return (
    <>
      <SettingsSection
        title="Sync"
        description="Your notes stay the same on all the computers that sync through this folder."
        actions={
          !status.paused && (
            <Button onClick={() => syncNow.mutate()} disabled={status.running || syncNow.isPending}>
              Sync now
            </Button>
          )
        }
      >
        <dl className="grid gap-x-6 gap-y-2.5 text-sm tablet:grid-cols-[auto_1fr]">
          <dt className="text-fg-3">Folder</dt>
          <dd className="min-w-0 break-words">
            {providerName(status.provider)} · {status.location}
          </dd>
          <dt className="text-fg-3">Status</dt>
          <dd>{state}</dd>
          {status.waiting > 0 && !status.running && (
            <>
              <dt className="text-fg-3">To send</dt>
              <dd>{status.waiting === 1 ? 'One change' : `${status.waiting} changes`} made here</dd>
            </>
          )}
          <dt className="text-fg-3">This computer</dt>
          <dd>{status.device?.name}</dd>
        </dl>
        {status.paused && (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-warn/45 bg-warn/10 px-3.5 py-3 text-sm">
            <p>{PAUSED[status.paused]}</p>
            {status.paused === 'signed_out' && google && <GoogleAgain />}
            {status.paused === 'signed_out' && dav && <PasswordAgain />}
            {(status.paused === 'restored' || status.paused === 'vault_changed') && (
              <div>
                <Button
                  variant="primary"
                  onClick={() => resume.mutate()}
                  disabled={resume.isPending}
                >
                  Sync again
                </Button>
              </div>
            )}
            <FormError message={resume.isError ? errorMessage(resume.error) : undefined} />
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="Computers" description="The computers that sync through this folder.">
        {status.devices.length === 0 ? (
          <p className="text-sm text-fg-2">This list fills in after the first sync.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {status.devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0"
              >
                <Laptop aria-hidden className="size-4 shrink-0 text-fg-3" />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {d.name}
                  {d.current && <span className="font-normal text-fg-3"> · this computer</span>}
                </span>
                {d.lastSeenAt && (
                  <span className="text-xs text-fg-3" title={formatDateTime(d.lastSeenAt)}>
                    {formatRelative(d.lastSeenAt, now)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <SettingsSection title="Privacy and security">
        <ul className="flex flex-col gap-2.5 text-sm text-fg-2">
          <Point icon={<ShieldCheck />}>
            Notes, files and their names are encrypted on this computer before they reach the
            folder. Your cloud provider sees only how many files there are, how large, and when they
            change.
          </Point>
          {google && (
            <Point icon={<FolderOpen />}>
              Memora sees only the files it made in your Google Drive. Google enforces that: the
              rest of your Drive is out of its reach.
            </Point>
          )}
          {dav && (
            <Point icon={<FolderOpen />}>
              Memora reads and writes in this one folder only. The password itself opens your whole
              account: make sure it’s an application password just for Memora, which you can revoke
              at any time.
            </Point>
          )}
          {status.provider === 'folder' && (
            <Point icon={<FolderOpen />}>
              Memora reads and writes in this one folder only, and holds no cloud sign-in.
            </Point>
          )}
          <Point icon={<KeyRound />}>
            The sign-in and the encryption key are kept by your computer’s own protection (the
            Windows credential store, the macOS Keychain or the Linux keyring), never in the notes
            or their backups.
          </Point>
        </ul>
      </SettingsSection>

      <SettingsSection
        title="Turn sync off"
        description="Sync stops on this computer. Your notes stay here, and in the folder for your other computers."
        actions={
          <Button variant="danger" onClick={() => setTurningOff(true)}>
            Turn off…
          </Button>
        }
      >
        <p className="text-sm text-fg-2">
          Memora forgets the sign-in and the key on this computer. To sync again later, set it up
          again with the same folder and passphrase.
        </p>
      </SettingsSection>
      <Dialog open={turningOff} onOpenChange={setTurningOff}>
        {turningOff && <TurnOff onDone={() => setTurningOff(false)} />}
      </Dialog>
    </>
  );
}

function TurnOff({ onDone }: { onDone: () => void }) {
  const setStatus = useSetStatus();
  const off = useMutation({
    mutationFn: () => api<SyncStatus>('DELETE', '/sync'),
    onSuccess: (status) => {
      setStatus(status);
      toast({ title: 'Sync is off on this computer', tone: 'success' });
      onDone();
    },
  });
  return (
    <DialogContent
      size="sm"
      title="Turn sync off on this computer?"
      description="Your notes stay on this computer, and your other computers keep syncing through the folder."
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="danger" onClick={() => off.mutate()} disabled={off.isPending}>
            Turn off
          </Button>
        </>
      }
    >
      {off.isError ? <FormError message={errorMessage(off.error)} /> : null}
    </DialogContent>
  );
}

function GoogleAgain() {
  const setStatus = useSetStatus();
  const start = useMutation({
    mutationFn: () => api<{ url: string }>('POST', '/sync/google/start'),
    onSuccess: async ({ url }) => {
      window.open(url, '_blank', 'noopener,noreferrer');
      setStatus(await api<SyncStatus>('GET', '/sync'));
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending}>
          Sign in to Google again
        </Button>
      </div>
      <FormError message={start.isError ? errorMessage(start.error) : undefined} />
    </div>
  );
}

function PasswordAgain() {
  const setStatus = useSetStatus();
  const [password, setPassword] = useState('');
  const save = useMutation({
    mutationFn: () => api<SyncStatus>('POST', '/sync/password', { password }),
    onSuccess: setStatus,
  });
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Password">
        {(ids) => (
          <div className="flex gap-2">
            <PasswordInput
              id={ids.id}
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              wrapperClassName="flex-1 max-w-sm"
            />
            <Button type="submit" variant="primary" disabled={!password || save.isPending}>
              Save
            </Button>
          </div>
        )}
      </Field>
      <FormError message={save.isError ? errorMessage(save.error) : undefined} />
    </form>
  );
}

/** A Google Cloud client of your own, for builds without one, or by choice. */
function OwnGoogleClient({ status }: { status: SyncStatus }) {
  const setStatus = useSetStatus();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api<SyncStatus>('PUT', '/sync/google-client', {
        clientId,
        ...(clientSecret ? { clientSecret } : {}),
      }),
    onSuccess: (next) => {
      setStatus(next);
      toast({ title: 'Google client saved', tone: 'success' });
    },
  });
  const remove = useMutation({
    mutationFn: () => api<SyncStatus>('DELETE', '/sync/google-client'),
    onSuccess: setStatus,
  });
  const errors = fieldsOf(save.error);
  return (
    <details className="glass rounded-xl px-4 py-3 text-sm [--glass-bg:var(--surface)] tablet:px-5">
      <summary className="cursor-pointer font-semibold">
        Advanced: your own Google Cloud client
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        <p className="text-fg-2">
          Memora can sign in to Google Drive with an OAuth client of your own (type “Desktop app”,
          with only the <code className="font-mono text-xs">drive.file</code> scope).{' '}
          <HelpLink href={HELP.sync}>How to make one</HelpLink>
        </p>
        {status.google.ownClient ? (
          <div className="flex items-center gap-3">
            <span>Your own client is in use.</span>
            <Button size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Remove
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Client ID" error={errors.clientId}>
              {(ids) => (
                <Input
                  id={ids.id}
                  invalid={ids.invalid}
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="….apps.googleusercontent.com"
                />
              )}
            </Field>
            <Field
              label="Client secret"
              hint="Google gives desktop clients one; it isn’t a real secret."
            >
              {(ids) => (
                <PasswordInput
                  id={ids.id}
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              )}
            </Field>
            <FormError
              message={save.isError && !errors.clientId ? errorMessage(save.error) : undefined}
            />
            <div>
              <Button type="submit" disabled={!clientId || save.isPending}>
                Save client
              </Button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}

/** The time, again every 30 seconds: for “synced 2 minutes ago”. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
