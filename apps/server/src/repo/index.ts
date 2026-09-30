import type { AdminUser, AuditEntry, AuditEvent, Role } from '@memora/shared';
import { uuidv7 } from '@memora/shared';
import { and, count, desc, eq, isNull, lt, max, ne, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SqliteDatabase } from '../db/client';
import {
  auditLog,
  sessions,
  userSettings,
  users,
  type SessionRow,
  type UserRow,
} from '../db/schema';

/*
 * The repository layer: the only code that queries the database for users, sessions, settings
 * and the audit log (notes have their own service in `notes/service.ts`). It is
 * **owner-scoped**: every method that reads or changes one user's data takes that user's id
 * and filters on it, so a route can never reach another user's rows by passing a foreign id.
 * Cross-user tests (auth/access.test.ts) check this for every route.
 */

export type Orm = BetterSQLite3Database;

export const createOrm = (db: SqliteDatabase): Orm => drizzle(db);

export interface NewUser {
  username: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  mustChangePassword: boolean;
}

export class UsersRepo {
  constructor(
    private readonly orm: Orm,
    private readonly now: () => number,
  ) {}

  count(): number {
    return this.orm.select({ n: count() }).from(users).get()?.n ?? 0;
  }

  /** Admins who can still log in: the last one can't be removed, demoted or disabled. */
  countActiveAdmins(): number {
    return (
      this.orm
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
        .get()?.n ?? 0
    );
  }

  /** The first admin who can log in: the owner of a desktop app's data. */
  firstActiveAdmin(): UserRow | undefined {
    return this.orm
      .select()
      .from(users)
      .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
      .orderBy(users.createdAt)
      .limit(1)
      .get();
  }

  findById(id: string): UserRow | undefined {
    return this.orm.select().from(users).where(eq(users.id, id)).get();
  }

  findByUsername(username: string): UserRow | undefined {
    return this.orm.select().from(users).where(eq(users.username, username.toLowerCase())).get();
  }

  create(input: NewUser): UserRow {
    const now = this.now();
    return this.orm
      .insert(users)
      .values({ id: uuidv7(now), ...input, createdAt: now, updatedAt: now })
      .returning()
      .get();
  }

  update(
    id: string,
    patch: Partial<
      Pick<UserRow, 'displayName' | 'passwordHash' | 'role' | 'mustChangePassword' | 'disabledAt'>
    >,
  ): UserRow | undefined {
    return this.orm
      .update(users)
      .set({ ...patch, updatedAt: this.now() })
      .where(eq(users.id, id))
      .returning()
      .get();
  }

  /** Deletes the user; their sessions and (later) all their data go with them (cascade). */
  delete(id: string): boolean {
    return this.orm.delete(users).where(eq(users.id, id)).run().changes > 0;
  }

  /** For the admin page: every user with their last activity and open sessions. */
  listForAdmin(): AdminUser[] {
    const now = this.now();
    const activity = this.orm
      .select({
        userId: sessions.userId,
        lastSeenAt: max(sessions.lastSeenAt).as('last_seen_at'),
        sessionCount: count().as('session_count'),
      })
      .from(sessions)
      .where(sql`${sessions.expiresAt} > ${now} AND ${sessions.absoluteExpiresAt} > ${now}`)
      .groupBy(sessions.userId)
      .as('activity');
    const rows = this.orm
      .select({ user: users, lastSeenAt: activity.lastSeenAt, sessionCount: activity.sessionCount })
      .from(users)
      .leftJoin(activity, eq(activity.userId, users.id))
      .orderBy(users.username)
      .all();
    return rows.map(({ user, lastSeenAt, sessionCount }) =>
      toAdminUser(user, lastSeenAt ?? null, sessionCount ?? 0),
    );
  }

  adminView(user: UserRow): AdminUser {
    return this.listForAdmin().find((u) => u.id === user.id) ?? toAdminUser(user, null, 0);
  }
}

export const toAdminUser = (
  user: UserRow,
  lastSeenAt: number | null,
  sessionCount: number,
): AdminUser => ({
  id: user.id,
  username: user.username,
  displayName: user.displayName,
  role: user.role,
  mustChangePassword: user.mustChangePassword,
  disabled: user.disabledAt !== null,
  twoFactor: user.totpEnabled,
  createdAt: user.createdAt,
  lastSeenAt,
  sessionCount,
});

export interface NewSession {
  userId: string;
  tokenHash: string;
  remember: boolean;
  expiresAt: number;
  absoluteExpiresAt: number;
  userAgent: string | null;
  ip: string | null;
  deviceLabel: string;
}

export class SessionsRepo {
  constructor(
    private readonly orm: Orm,
    private readonly now: () => number,
  ) {}

  create(input: NewSession): SessionRow {
    const now = this.now();
    return this.orm
      .insert(sessions)
      .values({ id: uuidv7(now), ...input, createdAt: now, lastSeenAt: now })
      .returning()
      .get();
  }

  /** Looks a session up by its token hash, with its user. Expiry is checked by the caller. */
  findByTokenHash(tokenHash: string): { session: SessionRow; user: UserRow } | undefined {
    return this.orm
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .get();
  }

  findById(id: string): { session: SessionRow; user: UserRow } | undefined {
    return this.orm
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, id))
      .get();
  }

  touch(id: string, lastSeenAt: number, expiresAt: number): void {
    this.orm.update(sessions).set({ lastSeenAt, expiresAt }).where(eq(sessions.id, id)).run();
  }

  /** Replaces the token (rotation) and returns the updated session. */
  rotate(id: string, tokenHash: string): SessionRow | undefined {
    return this.orm
      .update(sessions)
      .set({ tokenHash })
      .where(eq(sessions.id, id))
      .returning()
      .get();
  }

  listForUser(userId: string): SessionRow[] {
    const now = this.now();
    return this.orm
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          sql`${sessions.expiresAt} > ${now} AND ${sessions.absoluteExpiresAt} > ${now}`,
        ),
      )
      .orderBy(desc(sessions.lastSeenAt))
      .all();
  }

  /** Revokes one of the user's own sessions; false when it isn't theirs (or doesn't exist). */
  deleteForUser(userId: string, sessionId: string): boolean {
    return (
      this.orm
        .delete(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .run().changes > 0
    );
  }

  /** Revokes all of the user's sessions, optionally keeping one (the current device). */
  deleteAllForUser(userId: string, exceptSessionId?: string): number {
    const where = exceptSessionId
      ? and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId))
      : eq(sessions.userId, userId);
    return this.orm.delete(sessions).where(where).run().changes;
  }

  deleteById(sessionId: string): void {
    this.orm.delete(sessions).where(eq(sessions.id, sessionId)).run();
  }

  deleteExpired(): number {
    const now = this.now();
    return this.orm
      .delete(sessions)
      .where(sql`${sessions.expiresAt} <= ${now} OR ${sessions.absoluteExpiresAt} <= ${now}`)
      .run().changes;
  }
}

export interface AuditInput {
  userId?: string | null;
  username?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}

export class AuditRepo {
  constructor(
    private readonly orm: Orm,
    private readonly now: () => number,
  ) {}

  record(event: AuditEvent, input: AuditInput = {}): void {
    const now = this.now();
    this.orm
      .insert(auditLog)
      .values({
        id: uuidv7(now),
        event,
        userId: input.userId ?? null,
        username: input.username ?? null,
        metaJson: JSON.stringify(input.meta ?? {}),
        ip: input.ip ?? null,
        createdAt: now,
      })
      .run();
  }

  /** Newest first. `before` is the id of the last entry of the previous page. */
  page(limit: number, before?: string): { entries: AuditEntry[]; nextCursor: string | null } {
    const rows = this.orm
      .select()
      .from(auditLog)
      .where(before ? lt(auditLog.id, before) : undefined)
      .orderBy(desc(auditLog.id))
      .limit(limit + 1)
      .all();
    const entries = rows.slice(0, limit).map((row): AuditEntry => ({
      id: row.id,
      event: row.event as AuditEvent,
      username: row.username,
      meta: JSON.parse(row.metaJson) as Record<string, unknown>,
      ip: row.ip,
      createdAt: row.createdAt,
    }));
    return { entries, nextCursor: rows.length > limit ? (entries.at(-1)?.id ?? null) : null };
  }

  /** Keeps the log bounded: drops entries older than `maxAgeMs`, then beyond `maxRows`. */
  prune(maxAgeMs: number, maxRows: number): number {
    const byAge = this.orm
      .delete(auditLog)
      .where(lt(auditLog.createdAt, this.now() - maxAgeMs))
      .run().changes;
    const cutoff = this.orm
      .select({ id: auditLog.id })
      .from(auditLog)
      .orderBy(desc(auditLog.id))
      .limit(1)
      .offset(maxRows)
      .get();
    const byCount = cutoff
      ? this.orm
          .delete(auditLog)
          .where(sql`${auditLog.id} <= ${cutoff.id}`)
          .run().changes
      : 0;
    return byAge + byCount;
  }
}

/** One JSON value per user and key; callers validate what they read back. */
export class SettingsRepo {
  constructor(
    private readonly orm: Orm,
    private readonly now: () => number,
  ) {}

  get(userId: string, key: string): unknown {
    const row = this.orm
      .select({ valueJson: userSettings.valueJson })
      .from(userSettings)
      .where(and(eq(userSettings.userId, userId), eq(userSettings.key, key)))
      .get();
    return row ? (JSON.parse(row.valueJson) as unknown) : undefined;
  }

  set(userId: string, key: string, value: unknown): void {
    const valueJson = JSON.stringify(value);
    const updatedAt = this.now();
    this.orm
      .insert(userSettings)
      .values({ userId, key, valueJson, updatedAt })
      .onConflictDoUpdate({
        target: [userSettings.userId, userSettings.key],
        set: { valueJson, updatedAt },
      })
      .run();
  }
}

export interface Repos {
  users: UsersRepo;
  sessions: SessionsRepo;
  audit: AuditRepo;
  settings: SettingsRepo;
}

export function createRepos(orm: Orm, now: () => number): Repos {
  return {
    users: new UsersRepo(orm, now),
    sessions: new SessionsRepo(orm, now),
    audit: new AuditRepo(orm, now),
    settings: new SettingsRepo(orm, now),
  };
}
