import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { meKey, refreshSession, signedOut } from './auth/queries';
import { UIProvider } from './components/ui';
import { ApiRequestError, setCsrfSource, setSessionEvents } from './lib/api';
import { createAppRouter } from './router';
import { currentSync, startSync } from './sync/engine';
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

const router = createAppRouter({
  queryClient,
  startSync: (userId) =>
    startSync(userId, queryClient, {
      onSignedOut,
      refreshSession: () => refreshSession(queryClient),
    }),
});

// A request found the session gone, or a new password required: the route guards send the
// user to the right screen.
setSessionEvents({
  onSignedOut,
  onPasswordChangeRequired: () => {
    void queryClient.invalidateQueries({ queryKey: meKey }).then(() => router.invalidate());
  },
});

// After starting offline, the first change fetches the session's CSRF token.
setCsrfSource(() => (currentSync() ? refreshSession(queryClient) : Promise.resolve()));
registerServiceWorker();

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
