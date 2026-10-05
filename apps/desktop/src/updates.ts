import { app, dialog, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';

/** Set at build time: whether this app is signed (docs/SIGNING.md). */
declare const __MEMORA_SIGNED__: boolean;

export const DOWNLOAD_PAGE = 'https://dreamtheater484.github.io/memora/';
const SIX_HOURS = 6 * 3_600_000;
/** The Store's own list of updates, where it shows Memora's too. */
const STORE_UPDATES = 'ms-windows-store://downloadsandupdates';

/**
 * Whether the app can replace itself with a new version: on Windows, as an AppImage, and on
 * macOS once signed (macOS only lets signed apps update themselves). Otherwise it says a new
 * version is out, and the download page has it.
 */
function canInstall(): boolean {
  if (process.platform === 'win32') return true;
  if (process.platform === 'darwin') return __MEMORA_SIGNED__;
  return Boolean(process.env.APPIMAGE);
}

let offered: string | undefined;

async function offerDownload(info: UpdateInfo): Promise<void> {
  if (offered === info.version) return;
  offered = info.version;
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: `Memora ${info.version} is available`,
    detail: `You have ${app.getVersion()}. Download the new version and install it over this one: your notes stay as they are.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) void shell.openExternal(DOWNLOAD_PAGE);
}

async function offerRestart(info: UpdateInfo): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'info',
    message: `Memora ${info.version} is ready`,
    detail: 'It is installed when you close Memora, or now if you restart.',
    buttons: ['Restart now', 'Later'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response === 0) autoUpdater.quitAndInstall();
}

/**
 * Checks for a new version at start and every six hours, from the GitHub releases. Not in the
 * Microsoft Store's package: the Store updates it, as it does its other apps.
 */
export function startUpdates(): void {
  if (!app.isPackaged || process.env.MEMORA_NO_UPDATES || process.windowsStore) return;
  autoUpdater.logger = null;
  autoUpdater.autoDownload = canInstall();
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (info) => {
    if (!canInstall()) void offerDownload(info);
  });
  autoUpdater.on('update-downloaded', (info) => void offerRestart(info));
  // Offline, or GitHub unreachable: the next check tries again.
  autoUpdater.on('error', () => undefined);
  const check = () => void autoUpdater.checkForUpdates().catch(() => undefined);
  check();
  setInterval(check, SIX_HOURS);
}

/** Help → Check for updates: says what it found. */
export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged) {
    await dialog.showMessageBox({ message: 'Updates are checked in the installed app only.' });
    return;
  }
  if (process.windowsStore) {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      message: 'The Microsoft Store updates Memora',
      detail: `You have ${app.getVersion()}. The Store installs new versions by itself, as it does for your other apps.`,
      buttons: ['Open the Store’s updates', 'OK'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response === 0) void shell.openExternal(STORE_UPDATES);
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo.version;
    if (!latest || latest === app.getVersion()) {
      await dialog.showMessageBox({
        type: 'info',
        message: 'Memora is up to date',
        detail: `You have the newest version, ${app.getVersion()}.`,
      });
    } else if (!canInstall()) {
      await offerDownload(result.updateInfo);
    }
    // Otherwise it downloads now, and offers a restart when it is ready.
  } catch {
    await dialog.showMessageBox({
      type: 'warning',
      message: 'Memora couldn’t check for updates',
      detail: 'Check the internet connection, or look on the download page.',
    });
  }
}
