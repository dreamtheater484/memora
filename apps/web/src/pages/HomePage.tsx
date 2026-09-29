import { APP_NAME } from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api';

const TONE = { ok: 'bg-ok', error: 'bg-danger', pending: 'bg-warn' } as const;

/** Placeholder start page until the app shell lands. */
export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 30_000 });

  let status: { tone: keyof typeof TONE; text: string };
  if (health.isPending) {
    status = { tone: 'pending', text: 'Connecting to the server…' };
  } else if (health.isError || health.data.status !== 'ok') {
    status = { tone: 'error', text: 'Server unreachable' };
  } else {
    status = { tone: 'ok', text: `Server online · v${health.data.version}` };
  }

  return (
    <main className="aurora-bg grid h-full place-items-center p-6">
      <div className="glass w-full max-w-sm rounded-2xl p-8 text-center">
        <div
          className="mx-auto mb-4 grid size-12 place-items-center rounded-lg bg-accent font-display text-2xl font-bold text-on-accent"
          aria-hidden="true"
        >
          M
        </div>
        <h1 className="font-display text-3xl font-bold">{APP_NAME}</h1>
        <p className="mt-1 text-fg-2">Your notes, beautifully organised.</p>
        <p className="mt-6 inline-flex items-center gap-2 text-sm text-fg-2" role="status">
          <span className={`size-2 rounded-full ${TONE[status.tone]}`} aria-hidden="true" />
          {status.text}
        </p>
      </div>
    </main>
  );
}
