import { APP_NAME } from '@memora/shared';
import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../api';

/** Placeholder start page for the foundation build. The real interface arrives with Phase 1. */
export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 30_000 });

  let status: { tone: 'ok' | 'error' | 'pending'; text: string };
  if (health.isPending) {
    status = { tone: 'pending', text: 'Connecting to the server…' };
  } else if (health.isError || health.data.status !== 'ok') {
    status = { tone: 'error', text: 'Server unreachable' };
  } else {
    status = { tone: 'ok', text: `Server online · v${health.data.version}` };
  }

  return (
    <main className="home">
      <div className="card">
        <div className="logo" aria-hidden="true">
          M
        </div>
        <h1>{APP_NAME}</h1>
        <p className="tagline">Your notes, beautifully organised.</p>
        <p className={`status status-${status.tone}`} role="status">
          <span className="dot" aria-hidden="true" />
          {status.text}
        </p>
        <p className="hint">Foundation build: the full interface arrives in the next phase.</p>
      </div>
    </main>
  );
}
