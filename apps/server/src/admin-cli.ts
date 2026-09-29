import { existsSync } from 'node:fs';
import { DEFAULT_HASH_PARAMS, PasswordHasher } from './auth/password';
import { newTemporaryPassword } from './auth/tokens';
import { ConfigError, loadConfig } from './config';
import { openDatabase, type SqliteDatabase } from './db/client';
import { createOrm, createRepos } from './repo';

/*
 * memora-admin: maintenance commands for when the web interface can't help, such as an admin
 * who is locked out. Inside the container:
 *
 *   docker exec memora memora-admin list-users
 *   docker exec memora memora-admin reset-password <username>
 *
 * It works on the same database as the running server (SQLite handles both safely).
 */

const USAGE = `Usage: memora-admin <command>

Commands:
  list-users                  Show all accounts
  reset-password <username>   Set a one-time password (to be replaced at the next login)
                              and sign the user out everywhere
  hash-benchmark              Time one password hash with the current settings
  help                        Show this help
`;

function fail(message: string): never {
  console.error(`memora-admin: ${message}`);
  process.exit(1);
}

function openExisting(): SqliteDatabase {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) fail(error.message);
    throw error;
  }
  if (!existsSync(config.databaseFile)) {
    fail(`no database at ${config.databaseFile}. Start Memora once first.`);
  }
  const db = openDatabase(config.databaseFile);
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (!table) fail('the database has no accounts yet. Start this version of Memora once first.');
  return db;
}

const date = (ms: number | null) =>
  ms === null ? '—' : new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

function listUsers(): void {
  const db = openExisting();
  const users = createRepos(createOrm(db), Date.now).users.listForAdmin();
  db.close();
  if (users.length === 0) {
    console.log('No accounts yet: open Memora in a browser to run the first-run setup.');
    return;
  }
  const rows = users.map((u) => [
    u.username,
    u.displayName,
    u.role,
    u.disabled ? 'disabled' : u.mustChangePassword ? 'must change password' : 'active',
    date(u.lastSeenAt),
    date(u.createdAt),
  ]);
  const header = ['USERNAME', 'NAME', 'ROLE', 'STATUS', 'LAST SEEN (UTC)', 'CREATED (UTC)'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  for (const row of [header, ...rows]) {
    console.log(
      row
        .map((cell, i) => cell.padEnd(widths[i]!))
        .join('  ')
        .trimEnd(),
    );
  }
}

async function resetPassword(username: string | undefined): Promise<void> {
  if (!username) fail('which user? Usage: memora-admin reset-password <username>');
  const db = openExisting();
  const repos = createRepos(createOrm(db), Date.now);
  const user = repos.users.findByUsername(username);
  if (!user) {
    db.close();
    fail(`no user called "${username}". See: memora-admin list-users`);
  }
  const temporaryPassword = newTemporaryPassword();
  const passwordHash = await new PasswordHasher().hash(temporaryPassword);
  db.transaction(() => {
    repos.users.update(user.id, { passwordHash, mustChangePassword: true });
    repos.sessions.deleteAllForUser(user.id);
    repos.audit.record('password_reset', {
      username: 'memora-admin',
      meta: { targetId: user.id, target: user.username, via: 'command line' },
    });
  })();
  db.close();
  console.log(`One-time password for ${user.username}:  ${temporaryPassword}`);
  console.log('They must choose a new password when they log in. All their sessions were ended.');
  if (user.disabledAt !== null) {
    console.log(
      'Note: this account is disabled. An administrator can enable it on the Users page.',
    );
  }
}

async function hashBenchmark(): Promise<void> {
  const hasher = new PasswordHasher();
  const times: number[] = [];
  await hasher.hash('warm-up-password'); // first call loads the native module
  for (let i = 0; i < 5; i += 1) {
    const start = performance.now();
    await hasher.hash('benchmark-password');
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const { memoryCost, timeCost, parallelism } = DEFAULT_HASH_PARAMS;
  console.log(
    `Argon2id m=${memoryCost} KiB, t=${timeCost}, p=${parallelism}: ` +
      `${times[2]!.toFixed(0)} ms per hash (median of 5).`,
  );
  console.log('Logins take about this long on purpose; around 100–500 ms is a good range.');
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'list-users':
      listUsers();
      break;
    case 'reset-password':
      await resetPassword(args[0]);
      break;
    case 'hash-benchmark':
      await hashBenchmark();
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      break;
    default:
      console.error(`memora-admin: unknown command "${command}"\n`);
      console.error(USAGE);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
