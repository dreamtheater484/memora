import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app, dialog, safeStorage, type BrowserWindow, type UtilityProcess } from 'electron';

/*
 * What only the app's main process can do for Memora's server (ADR 0006): keep sync's secrets
 * (the cloud sign-in and the vault key) sealed by the operating system, and show the system's
 * folder picker. The server asks over the utility process's message port.
 *
 * Secrets are sealed with Electron's safeStorage: DPAPI on Windows, the Keychain on macOS, the
 * Secret Service (GNOME Keyring, KWallet) on Linux. Where Linux has no keyring, safeStorage
 * would only obscure them, so nothing is kept and the server says why.
 */

const BRIDGE = 'memora-bridge';
const file = () => path.join(app.getPath('userData'), 'sync.secrets');

interface Request {
  type: typeof BRIDGE;
  id: number;
  op: string;
  value?: unknown;
}

const isRequest = (message: unknown): message is Request =>
  typeof message === 'object' &&
  message !== null &&
  (message as Request).type === BRIDGE &&
  typeof (message as Request).id === 'number' &&
  typeof (message as Request).op === 'string';

/** Whether secrets can be sealed by the system here. */
export function secureStorage(): boolean {
  // macOS always has the Keychain, and asking reads it: an app whose signature changed (an
  // update of an unsigned build) would make macOS ask the person, at every start, to let
  // Memora in, though sync isn't used. The Keychain is only read once there are secrets.
  if (process.platform === 'darwin') return true;
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform !== 'linux') return true;
  const backend = safeStorage.getSelectedStorageBackend();
  return backend !== 'basic_text' && backend !== 'unknown';
}

function load(): string | null {
  let data: Buffer;
  try {
    data = readFileSync(file());
  } catch {
    return null;
  }
  if (!secureStorage()) return null;
  try {
    return safeStorage.decryptString(data);
  } catch {
    // Sealed for another login or another computer: of no use here.
    return null;
  }
}

function save(value: unknown): void {
  if (value === null || value === undefined) {
    rmSync(file(), { force: true });
    return;
  }
  if (typeof value !== 'string' || value.length > 64 * 1024) throw new Error('Not a secret.');
  if (!secureStorage()) throw new Error('This computer can’t keep secrets safely.');
  mkdirSync(path.dirname(file()), { recursive: true });
  // Written beside it and renamed over it: a crash never leaves half a file.
  writeFileSync(`${file()}.tmp`, safeStorage.encryptString(value), { mode: 0o600 });
  renameSync(`${file()}.tmp`, file());
}

async function answer(op: string, value: unknown, window: () => BrowserWindow | undefined) {
  switch (op) {
    case 'secrets.available':
      return secureStorage();
    case 'secrets.load':
      return load();
    case 'secrets.save':
      save(value);
      return true;
    case 'pick-folder': {
      const parent = window();
      const options = {
        title: 'Choose the folder to sync through',
        buttonLabel: 'Use this folder',
        properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    }
    default:
      throw new Error(`Unknown request: ${op}`);
  }
}

/** Answers the server's requests on its message port. */
export function serveBridge(child: UtilityProcess, window: () => BrowserWindow | undefined): void {
  child.on('message', (message: unknown) => {
    if (!isRequest(message)) return;
    const { id, op, value } = message;
    answer(op, value, window).then(
      (result) => child.postMessage({ type: BRIDGE, id, ok: true, value: result }),
      (error: unknown) =>
        child.postMessage({
          type: BRIDGE,
          id,
          ok: false,
          error: error instanceof Error ? error.message : 'Failed.',
        }),
    );
  });
}
