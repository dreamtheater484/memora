import { mkdirSync } from 'node:fs';
import { buildApp } from './app';
import { ConfigError, loadConfig } from './config';
import { openDatabase } from './db/client';
import { ensureInstanceMeta } from './db/meta';
import { runMigrations } from './db/migrate';
import { migrationsDir } from './paths';
import { APP_VERSION } from './version';

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
  const db = openDatabase(config.databaseFile);
  const app = await buildApp({ config, db, version: APP_VERSION });

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
  } catch (error) {
    app.log.fatal({ err: error }, 'could not prepare the database — Memora will not start');
    db.close();
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    await app.close();
    db.close(); // checkpoints the WAL so memora.db is self-contained on disk
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: config.host, port: config.port });
  app.log.info({ version: APP_VERSION, dataDir: config.dataDir }, 'Memora is running');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
