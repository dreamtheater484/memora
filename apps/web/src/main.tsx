import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { meKey, refreshSession, signedOut } from './auth/queries';
import { UIProvider } from './components/ui';
import { ApiRequestError, setCsrfSource, setSessionEvents } from './lib/api';
import { createAppRouter } from './router';
import { currentSync, startSync, stopSync } from './sync/engine';
import { watchInstall } from './lib/install';
import { registerServiceWorker } from './sync/worker';
import './styles/index.css';
import { applyAccent } from './theme/sections';
import { applyAppearance, useTheme } from './theme/theme';

applyAppearance(useTheme.getState());
applyAccent('blue');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // "Signed out" and "forbidden" won't fix themselves by retrying.
      retry: (count, error) =>
        count < 2 &&
        !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500),
    },
  },
});
const onSignedOut = () => {
  signedOut(queryClient);
  void router.invalidate();
};

/**
 * A new password or two-step verification comes first: syncing pauses (changes not sent yet
 * stay on the device), and the route guards send the user to the right screen. Opening the
 * notes again starts syncing again.
 */
const onSetUpRequired = () => {
  void stopSync()
    .then(() => queryClient.invalidateQueries({ queryKey: meKey }))
    .then(() => router.invalidate());
};

const router = createAppRouter({
  queryClient,
  startSync: (userId, dataId) =>
    startSync(userId, queryClient, {
      // The live channel closes for a session that ended, and for one that must first set a
      // new password or two-step verification: the server tells them apart.
      onSignedOut: () =>
        void refreshSession(queryClient).then(
          (still) => (still ? onSetUpRequired() : onSignedOut()),
          onSignedOut,
        ),
      refreshSession: () => refreshSession(queryClient),
      ...(dataId ? { dataId } : {}),
    }),
});

// A request found the session gone, or a new password or two-step verification required.
setSessionEvents({ onSignedOut, onSetUpRequired });

// After starting offline, the first change fetches the session's CSRF token.
setCsrfSource(() => (currentSync() ? refreshSession(queryClient) : Promise.resolve()));
registerServiceWorker();
watchInstall();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <RouterProvider router={router} />
      </UIProvider>
    </QueryClientProvider>
  </StrictMode>,
);
