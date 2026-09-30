import { app, BrowserWindow, dialog, Menu, shell } from 'electron';
import { applicationMenu } from './menu';
import { dataDir, logDir, RESTART_EXIT_CODE, startServer, type RunningServer } from './server';
import { checkForUpdatesNow, DOWNLOAD_PAGE, startUpdates } from './updates';
import { createWindow } from './window';

/*
 * Memora for your computer (Phase 14): the same server as in the Docker image, started on this
 * computer's loopback address only, and the same web app in a window of its own. One person,
 * no passwords: the window signs in with a secret made at each launch.
 */

// The end-to-end tests give each run a fresh folder for the app's data.
if (process.env.MEMORA_USER_DATA) app.setPath('userData', process.env.MEMORA_USER_DATA);

app.setAboutPanelOptions({
  applicationName: 'Memora',
  applicationVersion: app.getVersion(),
  copyright: 'Memora contributors. MIT licence.',
  website: DOWNLOAD_PAGE,
});

if (!app.requestSingleInstanceLock()) {
  // Memora is open already: that window comes forward instead (see 'second-instance').
  app.quit();
} else {
  run();
}

function run(): void {
  let server: RunningServer | undefined;
  let window: BrowserWindow | undefined;
  let quitting = false;
  const current = () => {
    if (!server) throw new Error('Memora is not running');
    return server;
  };

  const start = async () => {
    server = await startServer((code) => void stopped(code));
  };

  /** Memora stopped by itself: after restoring a backup it starts again; otherwise, ask. */
  const stopped = async (code: number) => {
    if (quitting) return;
    if (code === RESTART_EXIT_CODE) {
      await start();
      void window?.loadURL(current().signInUrl());
      return;
    }
    console.error(`Memora stopped unexpectedly (exit code ${code})`);
    const { response } = await dialog.showMessageBox({
      type: 'error',
      message: 'Memora stopped unexpectedly',
      detail: `Your notes are safe. What happened is in the log, in ${logDir()}.`,
      buttons: ['Start again', 'Show the log', 'Quit'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 1) void shell.openPath(logDir());
    if (response === 2) {
      app.quit();
      return;
    }
    await start();
    void window?.loadURL(current().signInUrl());
  };

  const about = () => {
    if (process.platform === 'darwin') {
      app.showAboutPanel();
      return;
    }
    void dialog.showMessageBox({
      type: 'info',
      message: `Memora ${app.getVersion()}`,
      detail: `Notebooks, Markdown, rich notes and Kanban boards.\nMIT licence. ${DOWNLOAD_PAGE}`,
    });
  };

  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(
      applicationMenu({
        open: (path) => void window?.loadURL(`${current().origin}${path}`),
        openDataFolder: () => void shell.openPath(dataDir()),
        openLogFolder: () => void shell.openPath(logDir()),
        checkForUpdates: () => void checkForUpdatesNow(),
        showLicences: () => void shell.openExternal(`${current().origin}/third-party-licenses.txt`),
        about,
      }),
    );
    try {
      await start();
    } catch (error) {
      console.error('Memora could not start:', error);
      dialog.showErrorBox(
        'Memora could not start',
        `${(error as Error).message}\n\nWhat happened is in the log, in ${logDir()}.`,
      );
      app.exit(1);
      return;
    }
    window = createWindow(current);
    window.on('closed', () => {
      window = undefined;
    });
    startUpdates();
  });

  // Closing the window closes Memora, on every system: nothing keeps running unseen.
  app.on('window-all-closed', () => app.quit());

  app.on('before-quit', (event) => {
    if (quitting || !server) return;
    event.preventDefault();
    if (window) {
      // The window closes first: the web app sends its last change and closes its connection
      // (or asks to wait for that change). Its closing brings Memora back here.
      window.close();
      return;
    }
    // Then Memora closes its database cleanly, and the app quits for real.
    quitting = true;
    void server.stop().finally(() => app.quit());
  });
}
