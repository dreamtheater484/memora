import { mkdirSync } from 'node:fs';
import { buildApp } from './app';
import { loadSecretKey, SecretKeyError } from './auth/secretKey';
import { applyPendingRestore } from './backup/service';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db/client';
import { ensureInstanceMeta } from './db/meta';
import { indexAllLinksOnce } from './notes/links';
import { runMigrations } from './db/migrate';
import { migrationsDir } from './paths';
import { APP_VERSION } from './version';

/** Exit code asking to be started again (after a restore): Docker's restart policy does. */
const RESTART_EXIT_CODE = 75;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  mkdirSync(config.dataDir, { recursive: true });
  // A backup chosen to be restored goes in place before the database is opened (§9.14).
  const restored = applyPendingRestore(config.dataDir, config.databaseFile);
  let secretKey;
  try {
    secretKey = loadSecretKey(config.secretKeyFile);
  } catch (error) {
    if (error instanceof SecretKeyError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const db = openDatabase(config.databaseFile);
  let requestRestart = () => undefined as void;
  const app = await buildApp({
    config,
    db,
    version: APP_VERSION,
    onRestart: () => requestRestart(),
    secretKey,
  });
  if (restored) app.log.info({ backup: restored }, 'backup restored');

  try {
    const result = await runMigrations({
      db,
      migrationsDir,
      backupDir: config.backupDir,
      appVersion: APP_VERSION,
    });
    if (result.applied > 0) {
      app.log.info(
        { applied: result.applied, backupFile: result.backupFile },
        'database schema updated',
      );
    }
    ensureInstanceMeta(db, APP_VERSION);
    const indexed = indexAllLinksOnce(db);
    if (indexed > 0) app.log.info({ pages: indexed }, 'links between pages indexed');
  } catch (error) {
    app.log.fatal({ err: error }, 'could not prepare the database — Memora will not start');
    db.close();
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals | 'restart') => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, signal === 'restart' ? 'restarting' : 'shutting down');
    await app.close();
    db.close(); // checkpoints the WAL so memora.db is self-contained on disk
    // A restart ends with a code the container's restart policy acts on (EX_TEMPFAIL).
    process.exit(signal === 'restart' ? RESTART_EXIT_CODE : 0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  requestRestart = () => void shutdown('restart');

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ version: APP_VERSION, dataDir: config.dataDir }, 'Memora is running');

  const setupCode = app.authService.startSetupIfNeeded();
  if (setupCode) {
    // Printed plainly (not as a JSON log line) so it is easy to spot in `docker logs`.
    process.stdout.write(setupBanner(setupCode));
    app.log.info('first-run setup required: the setup code is printed above');
  }
}

/** The one-time code that proves whoever creates the first admin can read the server log. */
function setupBanner(code: string): string {
  const line = '='.repeat(64);
  return [
    '',
    line,
    `  Memora setup code:  ${code}`,
    '',
    '  Open Memora in your browser and enter this code to create the',
    '  first (administrator) account. Until that is done, a new code',
    '  is printed every time Memora starts.',
    line,
    '',
    '',
  ].join('\n');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
