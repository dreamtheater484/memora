import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeTheme,
  screen,
  shell,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import type { RunningServer } from './server';
import { readSettings, saveSettings } from './settings';

/** Pages Memora itself shows; anything else opens in the computer's own browser. */
const opensOutside = (url: string) => /^(https?|mailto):/i.test(url);

/** The saved size and place, if it still fits on one of the screens. */
function savedBounds() {
  const bounds = readSettings().bounds;
  if (!bounds) return undefined;
  const visible = screen.getAllDisplays().some(({ workArea: area }) => {
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
  return visible ? bounds : undefined;
}

/**
 * The app's window: Memora's web app, served by the built-in server. It runs like a web page
 * in a browser (no Node.js, a sandbox), and only Memora's own address opens inside it.
 */
export function createWindow(server: () => RunningServer): BrowserWindow {
  const bounds = savedBounds();
  const window = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 820,
    ...(bounds ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: 'Memora',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1117' : '#f6f6fb',
    autoHideMenuBar: process.platform !== 'darwin',
    // Linux desktops take the icon from the desktop entry when there is one; an AppImage or
    // another window manager shows the window's own.
    ...(process.platform === 'linux' && app.isPackaged
      ? { icon: path.join(process.resourcesPath, 'icon.png') }
      : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (bounds?.maximized) window.maximize();
  guard(window.webContents, server);
  window.once('ready-to-show', () => window.show());
  window.on('close', () => {
    saveSettings({ bounds: { ...window.getNormalBounds(), maximized: window.isMaximized() } });
  });
  // Closing right after typing: the web app asks to stay while that change is on its way, as a
  // browser tab would. A browser shows the question itself; here the app does.
  window.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: 'question',
      message: 'Close Memora?',
      detail: 'Your last change is still being saved.',
      buttons: ['Wait', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
  void window.loadURL(server().signInUrl());
  return window;
}

function guard(contents: WebContents, server: () => RunningServer): void {
  const ours = (url: string) => {
    try {
      return new URL(url).origin === server().origin;
    } catch {
      return false;
    }
  };
  // New windows (help links, links in notes, the licence list) open in the computer's browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (opensOutside(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (ours(url)) return;
    event.preventDefault();
    if (opensOutside(url)) void shell.openExternal(url);
  });
  // The app has no password page: a session that ended signs in again by itself.
  const signInAgain = (url: string) => {
    if (!ours(url)) return;
    const { pathname } = new URL(url);
    if (pathname === '/login' || pathname === '/setup') void contents.loadURL(server().signInUrl());
  };
  contents.on('did-navigate', (_event, url) => signInAgain(url));
  contents.on('did-navigate-in-page', (_event, url) => signInAgain(url));
  // Copying to the clipboard and full screen; no camera, microphone, location or notifications.
  contents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write' || permission === 'fullscreen');
  });
  contents.on('context-menu', (_event, params) => textMenu(contents, params));
}

/**
 * The right-click menu for text, which a browser would show: spelling, cut, copy and paste.
 * Memora's own menus (for notes, tabs, tables) replace it where they apply.
 */
function textMenu(contents: WebContents, params: ContextMenuParams): void {
  const items: MenuItemConstructorOptions[] = [];
  for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
    items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
  }
  if (params.misspelledWord) {
    items.push(
      {
        label: 'Add to dictionary',
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      },
      { type: 'separator' },
    );
  }
  if (params.isEditable) {
    items.push(
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' },
    );
  } else if (params.selectionText) {
    items.push({ role: 'copy' });
  }
  if (params.linkURL && opensOutside(params.linkURL)) {
    items.push({ label: 'Copy link', click: () => clipboard.writeText(params.linkURL) });
  }
  if (items.length > 0) Menu.buildFromTemplate(items).popup();
}
