// Packaging with electron-builder: installers for Windows, macOS and Ubuntu (and an AppImage
// for other Linux systems), with fixed file names so the download page can always link to the
// newest release.
//
// Signing switches on by itself when its secrets are set (docs/SIGNING.md):
//   macOS    CSC_LINK and CSC_KEY_PASSWORD (a Developer ID certificate), and for notarising
//            APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID.
//   Windows  WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD (a certificate file), or Azure Artifact
//            Signing: AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and the four
//            MEMORA_AZURE_* values below.
// Without them the apps are built unsigned (macOS: signed "ad hoc", which Apple Silicon needs).
//
// With the Microsoft Store's identity for the app (MEMORA_STORE_*), a Store package is built
// too, for uploading in Partner Center: the Store signs it. Until the identity is set, CI builds
// it with a stand-in one, and tests it (scripts/test-store.ps1).

const env = process.env;
const macSigned = Boolean(env.CSC_LINK);
const notarize = macSigned && Boolean(env.APPLE_ID && env.APPLE_TEAM_ID);
const store = env.MEMORA_STORE_IDENTITY
  ? {
      identityName: env.MEMORA_STORE_IDENTITY,
      publisher: env.MEMORA_STORE_PUBLISHER,
      publisherDisplayName: env.MEMORA_STORE_PUBLISHER_NAME,
      applicationId: 'Memora',
      displayName: 'Memora',
      backgroundColor: '#4f46e5',
      artifactName: 'Memora-Store.${ext}',
    }
  : null;
const azure = env.MEMORA_AZURE_ENDPOINT
  ? {
      azureSignOptions: {
        publisherName: env.MEMORA_AZURE_PUBLISHER,
        endpoint: env.MEMORA_AZURE_ENDPOINT,
        codeSigningAccountName: env.MEMORA_AZURE_ACCOUNT,
        certificateProfileName: env.MEMORA_AZURE_PROFILE,
      },
    }
  : {};

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.github.dreamtheater484.memora',
  productName: 'Memora',
  copyright: 'Copyright © 2026 Memora contributors',
  directories: { output: 'release', buildResources: 'build-resources' },
  files: ['dist/**', 'package.json'],
  extraResources: [
    { from: 'build/memora', to: 'memora' },
    // The window's own icon on Linux (src/window.ts), where no desktop entry names one.
    { from: 'build-resources/icons/512x512.png', to: 'icon.png' },
  ],
  asar: true,
  // The app itself has no native packages; the server's are in its resources (scripts/resources.mjs).
  npmRebuild: false,
  // Where the app looks for updates (electron-updater), and what latest*.yml describe.
  publish: [{ provider: 'github', owner: 'dreamtheater484', repo: 'memora' }],

  win: {
    target: [
      { target: 'nsis', arch: ['x64'] },
      ...(store ? [{ target: 'appx', arch: ['x64'] }] : []),
    ],
    artifactName: 'Memora-Setup.${ext}',
    // Icons from scripts/icon.mjs: Windows and Linux fill their square, macOS keeps Apple's margin.
    icon: 'build-resources/icon-win.png',
    ...azure,
  },
  ...(store ? { appx: store } : {}),
  nsis: {
    // Click to install: for this user, no questions, no administrator rights.
    oneClick: true,
    perMachine: false,
    shortcutName: 'Memora',
    uninstallDisplayName: 'Memora',
    // Uninstalling keeps the notes; they stay in the user's app data.
    deleteAppDataOnUninstall: false,
  },

  mac: {
    // One app for Intel and Apple Silicon. The zip is what the app updates itself from.
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['universal'] },
    ],
    category: 'public.app-category.productivity',
    artifactName: 'Memora-mac.${ext}',
    icon: 'build-resources/icon.png',
    // The SQLite driver's builds for both processors are in both halves of the universal app,
    // the same files in each, which the merge refuses unless they're named here.
    x64ArchFiles:
      'Contents/Resources/memora/server/node_modules/better-sqlite3/prebuilds/darwin-*.node',
    identity: macSigned ? undefined : '-',
    hardenedRuntime: macSigned,
    entitlements: 'build-resources/entitlements.mac.plist',
    entitlementsInherit: 'build-resources/entitlements.mac.plist',
    notarize,
  },
  dmg: { artifactName: 'Memora.dmg', title: 'Memora' },

  linux: {
    target: ['deb', 'AppImage'],
    category: 'Office',
    executableName: 'memora',
    // One name for the desktop entry and the running window (desktopName in package.json),
    // so the dock shows Memora's icon for its window too, on Wayland as on X11.
    syncDesktopName: true,
    // Every size the icon theme has a folder for: a 1024 px icon alone isn't found.
    icon: 'build-resources/icons',
    synopsis: 'Notebooks, Markdown, rich notes and Kanban boards',
    description:
      'Memora keeps notebooks, Markdown and rich notes, and Kanban boards on your computer.',
    maintainer: 'Memora contributors <memora@users.noreply.github.com>',
    artifactName: 'Memora-${arch}.${ext}',
  },
};
