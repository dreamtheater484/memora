import type {
  AdminUser,
  AuditPage,
  ChangePasswordRequest,
  CreateUserRequest,
  CurrentUser,
  LoginRequest,
  MeResponse,
  SessionInfo,
  SessionResponse,
  SetupRequest,
  TemporaryPasswordResponse,
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
import { api, setCsrfToken } from '../lib/api';

export const meKey = ['auth', 'me'] as const;

/** "Who am I?": set up needed, signed out, or signed in (with the CSRF token). */
export const meQuery = queryOptions({
  queryKey: meKey,
  queryFn: async () => {
    const me = await api<MeResponse>('GET', '/auth/me');
    setCsrfToken(me.csrfToken);
    return me;
  },
  staleTime: 60_000,
  retry: 1,
});

/** The signed-in user. Only for screens behind the sign-in guard. */
export function useCurrentUser(): CurrentUser {
  const { data } = useSuspenseQuery(meQuery);
  if (!data.user) throw new Error('useCurrentUser outside the signed-in area');
  return data.user;
}

export function signedIn(queryClient: QueryClient, response: SessionResponse): void {
  setCsrfToken(response.csrfToken);
  queryClient.setQueryData<MeResponse>(meKey, {
    setupRequired: false,
    user: response.user,
    csrfToken: response.csrfToken,
  });
}

/** Forgets the session and everything loaded with it. */
export function signedOut(queryClient: QueryClient): void {
  setCsrfToken(null);
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  queryClient.setQueryData<MeResponse>(meKey, (old) => ({
    setupRequired: old?.setupRequired ?? false,
    user: null,
    csrfToken: null,
  }));
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: LoginRequest) => api<SessionResponse>('POST', '/auth/login', body),
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
      signedOut(queryClient);
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

const auditKey = ['admin', 'audit'] as const;

export const auditQuery = infiniteQueryOptions({
  queryKey: auditKey,
  queryFn: ({ pageParam }) =>
    api<AuditPage>('GET', `/admin/audit?limit=50${pageParam ? `&before=${pageParam}` : ''}`),
  initialPageParam: '',
  getNextPageParam: (page) => page.nextCursor ?? undefined,
});
