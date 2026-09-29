import { CloudOff, OctagonAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { SaveIndicator } from '../components/ui';
import { cn } from '../lib/cn';
import { useGlobalSaveState } from '../sync/hooks';
import { isOffline, useSync } from '../sync/status';
import { useGo } from './location';

/*
 * The app-wide sync status (§9.6): the indicator in the app bar, and a banner while the
 * server can't be reached or this browser can't store changes.
 */

const CONNECTION: Record<string, string> = {
  live: 'Changes from your other devices arrive as they happen.',
  polling:
    'The live connection is blocked (a proxy, perhaps), so Memora checks for changes from your other devices every 30 seconds.',
  connecting: 'Connecting for changes from your other devices…',
};

/** Everything this browser has, together: the app bar's indicator. */
export function GlobalSaveIndicator() {
  const state = useGlobalSaveState();
  const pending = useSync((s) => s.pending);
  const conflicts = useSync((s) => s.conflicts);
  const connection = useSync((s) => s.connection);
  const savedAt = useSync((s) => s.savedAt);
  const go = useGo();
  const last = Math.max(0, ...Object.values(savedAt)) || null;
  if (!state) return null;
  return (
    <SaveIndicator
      state={state}
      savedAt={last}
      pending={pending}
      hint={CONNECTION[connection]}
      detail="This browser can’t store changes on this device. They reach the server while this tab stays open."
      onClick={state === 'conflict' && conflicts[0] ? () => go.page(conflicts[0]!) : undefined}
    />
  );
}

function Banner({
  tone,
  icon,
  title,
  alert,
  children,
}: {
  tone: 'warn' | 'danger';
  icon: ReactNode;
  title: string;
  alert?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role={alert ? 'alert' : 'status'}
      className={cn(
        'mx-2 mb-2 flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-sm text-fg @tablet:mx-2.5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
        tone === 'warn'
          ? 'border-warn/45 bg-warn/10 [&>svg]:text-warn'
          : 'border-danger/45 bg-danger/10 [&>svg]:text-danger',
      )}
    >
      {icon}
      <p>
        <b className="font-semibold">{title}.</b> {children}
      </p>
    </div>
  );
}

/** Shown while changes can't reach the server, or can't be stored on this device. */
export function SyncBanner() {
  const storageError = useSync((s) => s.storageError);
  const durable = useSync((s) => s.durable);
  const offline = useSync(isOffline);
  const online = useSync((s) => s.online);
  const pending = useSync((s) => s.pending);
  if (storageError) {
    return (
      <Banner
        tone="danger"
        icon={<OctagonAlert />}
        title="Changes can’t be stored on this device"
        alert
      >
        {durable
          ? 'The browser stopped letting Memora store changes (it may be out of space).'
          : 'This browser doesn’t let Memora store changes (private browsing can do this).'}{' '}
        They go straight to the server instead, so keep this tab open until they show as saved.
      </Banner>
    );
  }
  if (!offline) return null;
  const waiting =
    pending > 1
      ? `${pending} changes are saved on this device and`
      : pending === 1
        ? 'One change is saved on this device and'
        : 'Changes are saved on this device and';
  return (
    <Banner
      tone="warn"
      icon={<CloudOff />}
      title={online ? 'Can’t reach the server' : 'You’re offline'}
    >
      {waiting} will be sent when the connection is back.
    </Banner>
  );
}
