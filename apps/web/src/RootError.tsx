import { useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { RefreshCw, WifiOff } from 'lucide-react';
import { Button, EmptyState } from './components/ui';
import { errorMessage } from './lib/api';

/** Shown when the app can't start, typically because the server can't be reached. */
export function RootError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="aurora-bg grid h-full place-items-center p-4">
      <div className="glass-raised w-full max-w-md rounded-2xl">
        <EmptyState
          icon={<WifiOff />}
          title="Can’t reach Memora"
          description={errorMessage(error)}
          actions={
            <Button variant="primary" onClick={() => void router.invalidate()}>
              <RefreshCw />
              Try again
            </Button>
          }
        />
      </div>
    </div>
  );
}
