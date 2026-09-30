import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';

const REPO = 'https://github.com/dreamtheater484/memora';

export interface MenuActions {
  /** Opens a page of the app, such as /settings/account. */
  open(path: string): void;
  openDataFolder(): void;
  openLogFolder(): void;
  checkForUpdates(): void;
  showLicences(): void;
  about(): void;
}

/**
 * The menu bar: on macOS the usual app menu, elsewhere hidden until Alt is pressed. The Edit
 * menu matters most: on macOS, copy and paste only work with it.
 */
export function applicationMenu(actions: MenuActions): Menu {
  const mac = process.platform === 'darwin';
  const settings: MenuItemConstructorOptions = {
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    click: () => actions.open('/settings/account'),
  };
  const updates: MenuItemConstructorOptions = {
    label: 'Check for updates…',
    click: actions.checkForUpdates,
  };
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { label: 'About Memora', click: actions.about },
              { type: 'separator' },
              settings,
              updates,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        ...(mac ? [] : [settings, { type: 'separator' } as const]),
        { label: 'Open the data folder', click: actions.openDataFolder },
        { label: 'Open the log folder', click: actions.openLogFolder },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'User guide',
          click: () =>
            void shell.openExternal(`${REPO}/blob/v${app.getVersion()}/docs/USER_GUIDE.md`),
        },
        { label: 'Open-source licences', click: actions.showLicences },
        { label: 'Report a problem', click: () => void shell.openExternal(`${REPO}/issues`) },
        ...(mac
          ? []
          : [
              { type: 'separator' } as const,
              updates,
              { label: 'About Memora', click: actions.about },
            ]),
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
