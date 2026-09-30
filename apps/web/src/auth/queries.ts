import type {
  AdminUser,
  AuditPage,
  ChangePasswordRequest,
  CreateUserRequest,
  CurrentUser,
  LoginRequest,
  LoginResponse,
  MeResponse,
  RecoveryCodesResponse,
  SecuritySettings,
  SessionInfo,
  SessionResponse,
  SetupRequest,
  TemporaryPasswordResponse,
  TwoFactorLoginRequest,
  TwoFactorSetup,
  TwoFactorStatus,
  UpdateUserRequest,
} from '@memora/shared';
import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { api, isUnreachable, setCsrfToken } from '../lib/api';
import { stopSync } from '../sync/engine';

export const meKey = ['auth', 'me'] as const;

// The signed-in user, remembered so the app can start without a connection (§9.6).
const USER_KEY = 'memora.user';

function rememberUser(user: CurrentUser | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Blocked storage: the app just needs a connection to start.
  }
}

function rememberedUser(): CurrentUser | null {
  try {
    const saved = localStorage.getItem(USER_KEY);
    return saved ? (JSON.parse(saved) as CurrentUser) : null;
  } catch {
    return null;
  }
}

/**
 * "Who am I?": set up needed, signed out, or signed in (with the CSRF token). Without a
 * connection, the last signed-in user carries on offline; the token follows once the server
 * can be reached.
 */
export const meQuery = queryOptions({
  queryKey: meKey,
  queryFn: async (): Promise<MeResponse> => {
    try {
      const me = await api<MeResponse>('GET', '/auth/me');
      setCsrfToken(me.csrfToken);
      rememberUser(me.user);
      return me;
    } catch (error) {
      const user = isUnreachable(error) ? rememberedUser() : null;
      if (!user || user.mustChangePassword || user.mustSetUpTwoFactor) throw error;
      return { setupRequired: false, user, csrfToken: null };
    }
  },
  staleTime: 60_000,
  retry: 1,
});

/** Checks the session again now; answers whether it is still signed in. */
export async function refreshSession(queryClient: QueryClient): Promise<boolean> {
  const me = await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
  return !!me.user;
}

/** The signed-in user. Only for screens behind the sign-in guard. */
export function useCurrentUser(): CurrentUser {
  const { data } = useSuspenseQuery(meQuery);
  if (!data.user) throw new Error('useCurrentUser outside the signed-in area');
  return data.user;
}

export function signedIn(queryClient: QueryClient, response: SessionResponse): void {
  setCsrfToken(response.csrfToken);
  rememberUser(response.user);
  queryClient.setQueryData<MeResponse>(meKey, {
    setupRequired: false,
    user: response.user,
    csrfToken: response.csrfToken,
  });
}

/**
 * Forgets the session and everything loaded with it. Changes not sent yet stay on this device
 * for the next sign-in; on logging out, the rest of its copy goes too.
 */
export function signedOut(queryClient: QueryClient, { forget = false } = {}): void {
  setCsrfToken(null);
  rememberUser(null);
  void stopSync({ forget });
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  queryClient.setQueryData<MeResponse>(meKey, (old) => ({
    setupRequired: old?.setupRequired ?? false,
    user: null,
    csrfToken: null,
  }));
}

/** The password step: signs in, or answers a ticket when a code must follow. */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api<LoginResponse>('POST', '/auth/login', body),
    onSuccess: (response) => {
      if ('user' in response) signedIn(queryClient, response);
    },
  });
}

/** The second step: the code from the authenticator app, or a recovery code. */
export function useLoginWithCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TwoFactorLoginRequest) =>
      api<SessionResponse>('POST', '/auth/login/two-factor', body),
    onSuccess: (response) => signedIn(queryClient, response),
  });
}

export function useSetup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SetupRequest) => api<SessionResponse>('POST', '/auth/setup', body),
    onSuccess: (response) => signedIn(queryClient, response),
  });
}

/** Logs out and shows the login screen, without a way back to the previous user's page. */
export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api<void>('POST', '/auth/logout'),
    // Signed out locally even if the server couldn't be told (it expires the session anyway).
    onSettled: () => {
      signedOut(queryClient, { forget: true });
      void router.navigate({ to: '/login' });
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ChangePasswordRequest) =>
      api<SessionResponse>('POST', '/auth/password', body),
    onSuccess: (response) => {
      signedIn(queryClient, response);
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) => api<CurrentUser>('PATCH', '/auth/me', { displayName }),
    onSuccess: (user) =>
      queryClient.setQueryData<MeResponse>(meKey, (old) => (old ? { ...old, user } : old)),
  });
}

// Two-step verification

const twoFactorKey = ['auth', 'two-factor'] as const;

export const twoFactorQuery = queryOptions({
  queryKey: twoFactorKey,
  queryFn: () => api<TwoFactorStatus>('GET', '/auth/two-factor'),
});

/** Keeps the signed-in user's `twoFactor` in step without asking the server again. */
function setTwoFactor(queryClient: QueryClient, on: boolean) {
  queryClient.setQueryData<MeResponse>(meKey, (old) => {
    if (!old?.user) return old;
    const user: CurrentUser = {
      ...old.user,
      twoFactor: on,
      mustSetUpTwoFactor: !on && queryClient.getQueryData<TwoFactorStatus>(twoFactorKey)?.required,
    };
    rememberUser(user);
    return { ...old, user };
  });
  void queryClient.invalidateQueries({ queryKey: twoFactorKey });
}

export const useStartTwoFactor = () =>
  useMutation({
    mutationFn: (password: string) =>
      api<TwoFactorSetup>('POST', '/auth/two-factor/setup', { password }),
  });

export function useEnableTwoFactor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api<RecoveryCodesResponse>('POST', '/auth/two-factor/enable', { code }),
    // The user is set when the recovery codes have been seen: the forced set-up page stays
    // until then.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: twoFactorKey });
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
}

/** After the recovery codes were shown: the account is protected. */
export const twoFactorDone = (queryClient: QueryClient) => setTwoFactor(queryClient, true);

export function useNewRecoveryCodes() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) =>
      api<RecoveryCodesResponse>('POST', '/auth/two-factor/recovery-codes', { password }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: twoFactorKey }),
  });
}

export function useDisableTwoFactor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => api<void>('POST', '/auth/two-factor/disable', { password }),
    onSuccess: () => setTwoFactor(queryClient, false),
  });
}

const sessionsKey = ['auth', 'sessions'] as const;

export const sessionsQuery = queryOptions({
  queryKey: sessionsKey,
  queryFn: () => api<SessionInfo[]>('GET', '/auth/sessions'),
});

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>('DELETE', `/auth/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  });
}

// Admin

const usersKey = ['admin', 'users'] as const;

export const usersQuery = queryOptions({
  queryKey: usersKey,
  queryFn: () => api<AdminUser[]>('GET', '/admin/users'),
});

function useUsersMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersKey });
      void queryClient.invalidateQueries({ queryKey: auditKey });
    },
  });
}

export const useCreateUser = () =>
  useUsersMutation((body: CreateUserRequest) =>
    api<TemporaryPasswordResponse>('POST', '/admin/users', body),
  );

export const useUpdateUser = () =>
  useUsersMutation(({ id, ...body }: UpdateUserRequest & { id: string }) =>
    api<AdminUser>('PATCH', `/admin/users/${id}`, body),
  );

export const useResetPassword = () =>
  useUsersMutation((id: string) =>
    api<TemporaryPasswordResponse>('POST', `/admin/users/${id}/reset-password`),
  );

export const useDeleteUser = () =>
  useUsersMutation((id: string) => api<void>('DELETE', `/admin/users/${id}`));

export const useResetTwoFactor = () =>
  useUsersMutation((id: string) => api<AdminUser>('POST', `/admin/users/${id}/two-factor/reset`));

const securityKey = ['admin', 'security'] as const;

export const securityQuery = queryOptions({
  queryKey: securityKey,
  queryFn: () => api<SecuritySettings>('GET', '/admin/security'),
});

export function useUpdateSecurity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SecuritySettings) => api<SecuritySettings>('PATCH', '/admin/security', body),
    onSuccess: (settings) => {
      queryClient.setQueryData(securityKey, settings);
      void queryClient.invalidateQueries({ queryKey: auditKey });
      void queryClient.invalidateQueries({ queryKey: twoFactorKey });
    },
  });
}

const auditKey = ['admin', 'audit'] as const;

export const auditQuery = infiniteQueryOptions({
  queryKey: auditKey,
  queryFn: ({ pageParam }) =>
    api<AuditPage>('GET', `/admin/audit?limit=50${pageParam ? `&before=${pageParam}` : ''}`),
  initialPageParam: '',
  getNextPageParam: (page) => page.nextCursor ?? undefined,
});
