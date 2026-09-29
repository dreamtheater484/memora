import { z } from 'zod';

/*
 * Accounts and sessions (§9.1, §10). The server validates every request with these schemas;
 * the web app uses the same ones for form hints, so both sides agree on the rules.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 1024;

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

/** Usernames are stored in lowercase, so "Alex" and "alex" are the same account. */
export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters.')
  .max(32, 'Use at most 32 characters.')
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    'Use letters, digits, dots, dashes and underscores, starting with a letter or digit.',
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  .max(64, 'Use at most 64 characters.');

/** Length only: the server also checks a list of common passwords (see the account rules). */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`);

/** Existing passwords are never re-validated against the current rules, only bounded. */
const passwordInputSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

export const setupRequestSchema = z.object({
  setupCode: z.string().min(1).max(64),
  username: usernameSchema,
  displayName: displayNameSchema,
  password: newPasswordSchema,
});
export type SetupRequest = z.infer<typeof setupRequestSchema>;

export const loginRequestSchema = z.object({
  // Not the full username rules: a typo should read as "wrong username or password".
  username: z.string().trim().toLowerCase().min(1).max(64),
  password: passwordInputSchema,
  remember: z.boolean().default(false),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: passwordInputSchema,
  newPassword: newPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const updateProfileRequestSchema = z.object({
  displayName: displayNameSchema,
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

export const createUserRequestSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  role: z.enum(ROLES).default('user'),
});
export type CreateUserRequest = z.input<typeof createUserRequestSchema>;

export const updateUserRequestSchema = z
  .object({
    displayName: displayNameSchema,
    role: z.enum(ROLES),
    disabled: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change.');
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

/** The signed-in user, as the web app sees it. */
export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
}

/** `GET /api/v1/auth/me`: always 200, so the app can tell "set up", "log in" and "signed in" apart. */
export interface MeResponse {
  setupRequired: boolean;
  user: CurrentUser | null;
  /** Send back as the `X-CSRF-Token` header on every request that changes data. */
  csrfToken: string | null;
  /**
   * The id of the server's data, when signed in. It changes when a backup is restored: what a
   * browser kept of the data before is then out of date (§9.14).
   */
  dataId?: string;
}

/** Returned by setup, login and password changes (which rotate the session). */
export interface SessionResponse {
  user: CurrentUser;
  csrfToken: string;
}

export interface SessionInfo {
  id: string;
  deviceLabel: string;
  ip: string | null;
  remember: boolean;
  createdAt: number;
  lastSeenAt: number;
  current: boolean;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: number;
  lastSeenAt: number | null;
  sessionCount: number;
}

/** Admin-created users and password resets get a one-time password, shown once. */
export interface TemporaryPasswordResponse {
  user: AdminUser;
  temporaryPassword: string;
}

export const AUDIT_EVENTS = [
  'setup_completed',
  'login',
  'login_failed',
  'logout',
  'password_changed',
  'profile_updated',
  'session_revoked',
  'user_created',
  'user_updated',
  'user_disabled',
  'user_enabled',
  'user_deleted',
  'password_reset',
  'backup_created',
  'backup_downloaded',
  'backup_restored',
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];

export interface AuditEntry {
  id: string;
  event: AuditEvent;
  /** Who did it (or tried to), when known. */
  username: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
  createdAt: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** Pass as `?before=` to get the next (older) page; null when there is none. */
  nextCursor: string | null;
}

export const CSRF_HEADER = 'x-csrf-token';
