import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { app, utilityProcess, type BrowserWindow } from 'electron';
import { serveBridge } from './bridge';
import { readSettings, saveSettings } from './settings';

/** The Google OAuth client for sync through Google Drive, added by CI (docs/GOOGLE_DRIVE.md). */
declare const __MEMORA_GOOGLE_CLIENT_ID__: string;
declare const __MEMORA_GOOGLE_CLIENT_SECRET__: string;

/** Memora's exit code when it wants to be started again: after a backup was restored. */
export const RESTART_EXIT_CODE = 75;

/**
 * Memora's folder. The Microsoft Store's package is the exception (docs/SIGNING.md): Windows
 * keeps what a Store app writes in AppData apart, and deletes it with the app. Its notes go in
 * the person's own folder instead, as in C:\Users\<name>\Memora, which uninstalling leaves.
 */
const memoraDir = () =>
  process.windowsStore ? path.join(app.getPath('home'), 'Memora') : app.getPath('userData');

/** The notes: memora.db, the backups and the instance key, as on a server's /data. */
export const dataDir = () => path.join(memoraDir(), 'Data');
export const logDir = () => path.join(memoraDir(), 'logs');

/** The server bundle, its migrations and the web app: beside the app, or built for development. */
export function resourcesDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'memora')
    : path.join(app.getAppPath(), 'build', 'memora');
}

export interface RunningServer {
  /** Where the window finds Memora: http://127.0.0.1:<port>. */
  origin: string;
  /** The address that signs the window in with this launch's secret, then opens `next`. */
  signInUrl(next?: string): string;
  /** Asks Memora to stop (it closes the database cleanly), then makes sure it did. */
  stop(): Promise<void>;
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () =>
      probe.close(() => resolve(true)),
    );
  });
}

/**
 * The same port every launch: the web app keeps its offline copy and settings per address, so
 * a new port would start those over. A new one only when something else has taken it.
 */
async function choosePort(): Promise<number> {
  const saved = readSettings().port;
  if (saved && (await portIsFree(saved))) return saved;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const port = 20_000 + Math.floor(Math.random() * 30_000);
    if (await portIsFree(port)) {
      saveSettings({ port });
      return port;
    }
  }
  throw new Error('This computer has no free port for Memora.');
}

/** memora.log, with the previous one kept as memora.old.log once it passes 5 MB. */
function openLog(): WriteStream {
  mkdirSync(logDir(), { recursive: true });
  const file = path.join(logDir(), 'memora.log');
  try {
    if (statSync(file).size > 5 * 1024 * 1024) {
      renameSync(file, path.join(logDir(), 'memora.old.log'));
    }
  } catch {
    // No log yet.
  }
  return createWriteStream(file, { flags: 'a' });
}

/** The environment the server starts with: this computer's, without Memora settings of its own. */
function serverEnv(settings: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('MEMORA_')) env[name] = value;
  }
  return { ...env, ...settings };
}

/**
 * Starts Memora's server (the same bundle as in the Docker image) as Electron's utility
 * process, on this computer's loopback address only, and waits until it answers. `onExit`
 * hears of it stopping by itself: after a restore (RESTART_EXIT_CODE), or a crash.
 */
export async function startServer(
  onExit: (code: number) => void,
  window: () => BrowserWindow | undefined = () => undefined,
): Promise<RunningServer> {
  const port = await choosePort();
  const token = randomBytes(32).toString('base64url');
  const origin = `http://127.0.0.1:${port}`;
  mkdirSync(dataDir(), { recursive: true });
  const log = openLog();

  const child = utilityProcess.fork(path.join(resourcesDir(), 'server', 'dist', 'server.mjs'), [], {
    serviceName: 'Memora server',
    stdio: 'pipe',
    // The same cap as the container's default: Memora's memory use stays predictable.
    execArgv: ['--max-old-space-size=256'],
    env: serverEnv({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: String(port),
      MEMORA_DATA_DIR: dataDir(),
      MEMORA_BASE_URL: origin,
      MEMORA_TRUST_PROXY: 'false',
      MEMORA_DESKTOP_TOKEN: token,
      MEMORA_DESKTOP_NAME: os.userInfo().username,
      ...(__MEMORA_GOOGLE_CLIENT_ID__
        ? {
            MEMORA_GOOGLE_CLIENT_ID: __MEMORA_GOOGLE_CLIENT_ID__,
            MEMORA_GOOGLE_CLIENT_SECRET: __MEMORA_GOOGLE_CLIENT_SECRET__,
          }
        : {}),
    }),
  });
  // Sync's secrets and the folder picker (ADR 0006).
  serveBridge(child, window);
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });

  let exited = false;
  let stopping = false;
  const exit = new Promise<number>((resolve) => {
    child.once('exit', (code) => {
      exited = true;
      log.end();
      resolve(code);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Memora did not start within a minute.')),
      60_000,
    );
    child.on('message', (message: { type?: string }) => {
      if (message?.type !== 'ready') return;
      clearTimeout(timer);
      resolve();
    });
    void exit.then((code) => {
      clearTimeout(timer);
      reject(new Error(`Memora stopped while starting (exit code ${code}).`));
    });
  });
  void exit.then((code) => {
    if (!stopping) onExit(code);
  });

  return {
    origin,
    signInUrl: (next = '/') =>
      `${origin}/api/v1/auth/desktop?token=${token}&next=${encodeURIComponent(next)}`,
    async stop() {
      if (exited) return;
      stopping = true;
      child.postMessage('shutdown');
      const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
      await Promise.race([exit, timeout(10_000)]);
      if (exited) return;
      // It didn't stop in time. On Windows kill() ends it; elsewhere it sends SIGTERM, which a
      // server already stopping doesn't act on again, so it gets SIGKILL.
      if (process.platform === 'win32' || !child.pid) child.kill();
      else process.kill(child.pid, 'SIGKILL');
      await Promise.race([exit, timeout(5_000)]);
    },
  };
}
