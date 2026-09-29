import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Conventions (§7): UUIDv7 primary keys, UTC epoch milliseconds, foreign keys enforced.

/** Instance-level facts: the instance id, the version that created the database, … */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    /** Always lowercase, so the unique constraint is case-insensitive. */
    username: text('username').notNull().unique(),
    displayName: text('display_name').notNull(),
    /** PHC string: `$argon2id$v=19$m=…,t=…,p=…$salt$hash`. */
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'user'] })
      .notNull()
      .default('user'),
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    // Two-factor authentication arrives in Phase 12; the columns exist from the start.
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
    disabledAt: integer('disabled_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('users_username_lowercase', sql`${t.username} = lower(${t.username})`),
    check('users_role_valid', sql`${t.role} IN ('admin', 'user')`),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    /** "Remember this device": a persistent cookie and the longer idle timeout. */
    remember: integer('remember', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    /** Idle expiry: moves forward while the session is used. */
    expiresAt: integer('expires_at').notNull(),
    /** Absolute expiry: never moves. */
    absoluteExpiresAt: integer('absolute_expires_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    deviceLabel: text('device_label').notNull(),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: integer('used_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('recovery_codes_user_id_idx').on(t.userId)],
);

export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    /** Who did it. Kept (as null) when that user is deleted; `username` keeps the name. */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    username: text('username'),
    event: text('event').notNull(),
    metaJson: text('meta_json').notNull().default('{}'),
    ip: text('ip'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('audit_log_created_at_idx').on(t.createdAt),
    index('audit_log_user_id_idx').on(t.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
