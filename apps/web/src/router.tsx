import { Outlet, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './shell/AppShell';

const rootRoute = createRootRoute({ component: Outlet });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AppShell,
});

export const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute]) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
