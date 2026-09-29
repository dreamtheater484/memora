import type { MeResponse } from '@memora/shared';
import type { QueryClient } from '@tanstack/react-query';
import {
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from '@tanstack/react-router';
import { ChangePasswordPage } from './auth/ChangePasswordPage';
import { LoginPage } from './auth/LoginPage';
import { meQuery } from './auth/queries';
import { SetupPage } from './auth/SetupPage';
import { safeRedirect } from './lib/redirect';
import { settingsQuery, treeQuery } from './notes/queries';
import { RootError } from './RootError';
import { AccountPage } from './settings/AccountPage';
import { SettingsLayout } from './settings/SettingsLayout';
import { AppShell } from './shell/AppShell';

export interface RouterContext {
  queryClient: QueryClient;
  /** Starts syncing the signed-in user's notes (§9.6). */
  startSync: (userId: string) => Promise<unknown>;
}

const me = (context: RouterContext): Promise<MeResponse> =>
  context.queryClient.ensureQueryData(meQuery);

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RootError,
});

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async ({ context }) => {
    const state = await me(context);
    if (!state.setupRequired) throw redirect({ to: state.user ? '/' : '/login' });
  },
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  // Always set the key: search params are merged over the parent route's raw ones, so
  // leaving it out would let an unsafe value through.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeRedirect(search.redirect),
  }),
  beforeLoad: async ({ context, search }) => {
    const state = await me(context);
    if (state.setupRequired) throw redirect({ to: '/setup' });
    if (state.user?.mustChangePassword) throw redirect({ to: '/change-password' });
    if (state.user) throw redirect({ href: search.redirect ?? '/' });
  },
  component: LoginPage,
});

const changePasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/change-password',
  beforeLoad: async ({ context }) => {
    const state = await me(context);
    if (!state.user) throw redirect({ to: '/login' });
    if (!state.user.mustChangePassword) throw redirect({ to: '/' });
  },
  component: ChangePasswordPage,
});

/** Everything below needs a signed-in user with their own password. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const state = await me(context);
    if (state.setupRequired) throw redirect({ to: '/setup' });
    if (!state.user) {
      const back = location.href === '/' ? undefined : location.href;
      throw redirect({ to: '/login', search: back ? { redirect: back } : {} });
    }
    if (state.user.mustChangePassword) throw redirect({ to: '/change-password' });
  },
  component: Outlet,
});

/** The notes app. The URL says where you are; the shell renders every level. */
const notesRoute = createRoute({
  getParentRoute: () => appRoute,
  id: 'notes',
  loader: async ({ context }) => {
    // The store first: without a connection, the tree and settings come from it.
    const { user } = await me(context);
    if (user) await context.startSync(user.id);
    return Promise.all([
      context.queryClient.ensureQueryData(treeQuery),
      context.queryClient.ensureQueryData(settingsQuery),
    ]);
  },
  component: AppShell,
});

const parent = () => notesRoute;
const homeRoute = createRoute({ getParentRoute: parent, path: '/' });
const notebookRoute = createRoute({ getParentRoute: parent, path: '/n/$notebookId' });
const groupRoute = createRoute({ getParentRoute: parent, path: '/g/$groupId' });
const sectionRoute = createRoute({ getParentRoute: parent, path: '/s/$sectionId' });
const pageRoute = createRoute({ getParentRoute: parent, path: '/p/$pageId' });
const boardRoute = createRoute({ getParentRoute: parent, path: '/b/$boardId' });

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsLayout,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/settings/account' });
  },
});

const accountRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'account',
  component: AccountPage,
});

const adminRoute = createRoute({
  getParentRoute: () => settingsRoute,
  id: 'admin',
  beforeLoad: async ({ context }) => {
    const state = await me(context);
    if (state.user?.role !== 'admin') throw redirect({ to: '/settings/account' });
  },
  component: Outlet,
});

// Admin pages are loaded on demand: most sessions never open them.
const usersRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'users',
  component: lazyRouteComponent(() => import('./settings/UsersPage'), 'UsersPage'),
});

const auditRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'audit',
  component: lazyRouteComponent(() => import('./settings/AuditPage'), 'AuditPage'),
});

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  changePasswordRoute,
  appRoute.addChildren([
    notesRoute.addChildren([
      homeRoute,
      notebookRoute,
      groupRoute,
      sectionRoute,
      pageRoute,
      boardRoute,
    ]),
    settingsRoute.addChildren([
      settingsIndexRoute,
      accountRoute,
      adminRoute.addChildren([usersRoute, auditRoute]),
    ]),
  ]),
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: 'intent',
    // The session check is fast; don't flash a loading screen for it.
    defaultPendingMs: 400,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
