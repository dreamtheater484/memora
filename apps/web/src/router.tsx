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
import { validateSearchParams } from './search/api';
import { settingsQuery, treeQuery } from './notes/queries';
import { RootError } from './RootError';
import { AccountPage } from './settings/AccountPage';
import { EditingPage } from './settings/EditingPage';
import { SettingsLayout } from './settings/SettingsLayout';
import { AppShell } from './shell/AppShell';
import { SignedIn } from './SignedIn';

export interface RouterContext {
  queryClient: QueryClient;
  /** Starts syncing the signed-in user's notes (§9.6), from the server's data `dataId`. */
  startSync: (userId: string, dataId?: string) => Promise<unknown>;
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
  component: SignedIn,
});

/** The notes app. The URL says where you are; the shell renders every level. */
const notesRoute = createRoute({
  getParentRoute: () => appRoute,
  id: 'notes',
  loader: async ({ context }) => {
    // The store first: without a connection, the tree and settings come from it.
    const { user, dataId } = await me(context);
    if (user) await context.startSync(user.id, dataId);
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
const trashRoute = createRoute({ getParentRoute: parent, path: '/trash' });
const searchRoute = createRoute({
  getParentRoute: parent,
  path: '/search',
  validateSearch: validateSearchParams,
});

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

const editingRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'editing',
  component: EditingPage,
});

const dataRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'data',
  component: lazyRouteComponent(() => import('./settings/DataPage'), 'DataPage'),
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

const backupsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'backups',
  component: lazyRouteComponent(() => import('./settings/BackupsPage'), 'BackupsPage'),
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
      trashRoute,
      searchRoute,
    ]),
    settingsRoute.addChildren([
      settingsIndexRoute,
      accountRoute,
      editingRoute,
      dataRoute,
      adminRoute.addChildren([usersRoute, auditRoute, backupsRoute]),
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
