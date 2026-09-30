import type { BackupInfo, BackupKind, BackupStatus, RestoreStarted } from '@memora/shared';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore,
  CircleAlert,
  CircleCheck,
  DatabaseBackup,
  Download,
  Ellipsis,
  LockKeyhole,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormError } from '../auth/AuthLayout';
import {
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  toast,
} from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { formatBytes } from '../lib/bytes';
import { formatDateTime, formatRelative } from '../lib/time';
import { SettingsSection } from './SettingsLayout';
import { HelpLink } from '../components/HelpLink';
import { HELP } from '../lib/help';

/*
 * Backups (§9.14), for administrators: when they are made and how many are kept, making one
 * now, downloading one, and restoring one (which backs up first and restarts Memora).
 */

const backupsKey = ['admin', 'backups'] as const;

const backupsQuery = queryOptions({
  queryKey: backupsKey,
  queryFn: () => api<BackupStatus>('GET', '/admin/backups'),
});

const KIND: Record<BackupKind, string> = {
  scheduled: 'Scheduled',
  manual: 'Made by hand',
  'pre-migration': 'Before an update',
  'pre-restore': 'Before a restore',
  'pre-import': 'Before an import',
};

const downloadUrl = (name: string) => `/api/v1/admin/backups/${encodeURIComponent(name)}`;

/** Waits for Memora to answer again after its restart, then starts the app afresh. */
function Restarting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let live = true;
    const started = Date.now();
    const check = async () => {
      // Give the server a moment to go down first.
      await new Promise((r) => setTimeout(r, 2000));
      while (live) {
        try {
          const res = await fetch('/api/health', { cache: 'no-store' });
          if (res.ok) {
            window.location.assign('/');
            return;
          }
        } catch {
          // Still restarting.
        }
        if (Date.now() - started > 60_000) setSlow(true);
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    void check();
    return () => {
      live = false;
    };
  }, []);
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-6 text-center text-sm">
      <ArchiveRestore aria-hidden className="size-8 animate-pulse text-accent" />
      <p className="font-semibold">Restoring the backup: Memora is restarting…</p>
      <p className="max-w-sm text-fg-2">
        {slow
          ? 'This takes longer than it should. Check that the container restarts on its own (a restart policy such as “unless-stopped”), or start it again.'
          : 'This page reloads when Memora is back.'}
      </p>
    </div>
  );
}

function RestoreDialog({ backup, onDone }: { backup: BackupInfo; onDone: () => void }) {
  const restore = useMutation({
    mutationFn: () =>
      api<RestoreStarted>('POST', `/admin/backups/${encodeURIComponent(backup.name)}/restore`),
  });
  if (restore.isSuccess) {
    return (
      <DialogContent title="Restoring" hideClose onEscapeKeyDown={(e) => e.preventDefault()}>
        <Restarting />
      </DialogContent>
    );
  }
  return (
    <DialogContent
      title="Restore this backup?"
      description={`Everything goes back to how it was on ${formatDateTime(backup.createdAt)}: notes, files, users and settings.`}
      footer={
        <>
          <Button onClick={onDone} disabled={restore.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => restore.mutate()} disabled={restore.isPending}>
            {restore.isPending ? 'Preparing…' : 'Restore and restart'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-fg-2">
        <p>
          Everything as it is now is backed up first (“Before a restore”), so you can go back to it.
          Then Memora restarts, which takes a moment; whoever signed in after this backup was made
          has to sign in again.
        </p>
        <p>Browsers drop what they kept of the notes and load them afresh.</p>
        {restore.isError && <FormError message={errorMessage(restore.error)} />}
      </div>
    </DialogContent>
  );
}

function DeleteDialog({ backup, onDone }: { backup: BackupInfo; onDone: () => void }) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api<void>('DELETE', `/admin/backups/${encodeURIComponent(backup.name)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: backupsKey });
      toast({ title: 'Backup deleted', tone: 'success' });
      onDone();
    },
  });
  return (
    <DialogContent
      size="sm"
      title="Delete this backup?"
      description={`The backup from ${formatDateTime(backup.createdAt)} is deleted for good.`}
      footer={
        <>
          <Button onClick={onDone}>Cancel</Button>
          <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Delete backup
          </Button>
        </>
      }
    >
      {remove.isError ? <FormError message={errorMessage(remove.error)} /> : null}
    </DialogContent>
  );
}

function Summary({ status }: { status: BackupStatus }) {
  const { keep } = status;
  return (
    <dl className="grid gap-x-6 gap-y-2.5 text-sm tablet:grid-cols-[auto_1fr]">
      <dt className="text-fg-3">Schedule</dt>
      <dd>
        {status.schedule ? (
          <>
            <code className="rounded-xs bg-hover px-1 font-mono text-xs">{status.schedule}</code>
            {status.nextRunAt && (
              <span className="text-fg-2"> · next {formatDateTime(status.nextRunAt)}</span>
            )}
          </>
        ) : (
          <span className="text-fg-2">
            Off: backups are only made by hand (<code>MEMORA_BACKUP_SCHEDULE=off</code>).
          </span>
        )}
      </dd>
      <dt className="text-fg-3">Last backup</dt>
      <dd>
        {status.last ? (
          status.last.ok ? (
            <span className="inline-flex items-center gap-1.5">
              <CircleCheck aria-hidden className="size-4 text-ok" />
              {formatRelative(status.last.at)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-danger">
              <CircleAlert aria-hidden className="size-4" />
              Failed {formatRelative(status.last.at)}: {status.last.error}
            </span>
          )
        ) : (
          <span className="text-fg-2">None since Memora started.</span>
        )}
      </dd>
      <dt className="text-fg-3">Encryption</dt>
      <dd className="text-fg-2">
        {status.encrypting
          ? 'New backups are encrypted with the password in MEMORA_BACKUP_PASSWORD_FILE. Keep that password safe: without it they can’t be restored.'
          : 'Off. Set MEMORA_BACKUP_PASSWORD_FILE to encrypt new backups.'}
      </dd>
      <dt className="text-fg-3">Kept</dt>
      <dd className="text-fg-2">
        Everything from the last day, then {keep.daily} daily, {keep.weekly} weekly and{' '}
        {keep.monthly} monthly backups.
      </dd>
    </dl>
  );
}

export function BackupsPage() {
  const queryClient = useQueryClient();
  const status = useQuery(backupsQuery);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const [deleting, setDeleting] = useState<BackupInfo | null>(null);
  const create = useMutation({
    mutationFn: () => api<BackupInfo>('POST', '/admin/backups'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: backupsKey });
      toast({ title: 'Backup made', tone: 'success' });
    },
    onError: (error) =>
      toast({ title: 'Couldn’t make a backup', description: errorMessage(error), tone: 'error' }),
  });

  return (
    <>
      <SettingsSection
        title="Backups"
        description={
          <>
            Memora backs up its database into its backup folder. Copy that folder somewhere else as
            well, with Hyper Backup for example.{' '}
            <HelpLink href={HELP.backups}>Backups and restoring</HelpLink>
          </>
        }
        actions={
          <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
            <DatabaseBackup /> {create.isPending ? 'Backing up…' : 'Back up now'}
          </Button>
        }
      >
        {status.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : status.isError ? (
          <FormError message={errorMessage(status.error)} />
        ) : (
          <Summary status={status.data} />
        )}
      </SettingsSection>
      {status.data && (
        <SettingsSection
          title="Saved backups"
          description="Newest first. Restoring one backs up the current state first."
        >
          {status.data.backups.length === 0 ? (
            <p className="text-sm text-fg-2">No backups yet.</p>
          ) : (
            <ul aria-label="Backups" className="-my-1.5 divide-y divide-line">
              {status.data.backups.map((backup) => (
                <li key={backup.name} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      {formatDateTime(backup.createdAt)}
                      {backup.encrypted && (
                        <LockKeyhole aria-label="Encrypted" className="size-3.5 text-fg-3" />
                      )}
                    </p>
                    <p className="truncate text-xs text-fg-3">
                      {KIND[backup.kind]} · {formatBytes(backup.size)}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setRestoring(backup)}>
                    <ArchiveRestore /> Restore…
                  </Button>
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton label="More" icon={<Ellipsis />} size="sm" />
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem
                        icon={<Download />}
                        onSelect={() => window.location.assign(downloadUrl(backup.name))}
                      >
                        Download
                      </MenuItem>
                      <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(backup)}>
                        Delete
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      )}
      <Dialog open={!!restoring} onOpenChange={(open) => !open && setRestoring(null)}>
        {restoring && <RestoreDialog backup={restoring} onDone={() => setRestoring(null)} />}
      </Dialog>
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        {deleting && <DeleteDialog backup={deleting} onDone={() => setDeleting(null)} />}
      </Dialog>
    </>
  );
}
