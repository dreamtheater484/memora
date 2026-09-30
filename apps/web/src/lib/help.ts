import { version } from '../../../../package.json';

/** This Memora's version, from the root package.json (plan §13.3). */
export const APP_VERSION: string = version;

const REPO = 'https://github.com/dreamtheater484/memora';
/** The guides as released with this version, so they describe what is running. */
const DOCS = `${REPO}/blob/v${APP_VERSION}/docs`;

/** Where the in-app help links go (Phase 13); the anchors are checked against the guides. */
export const HELP = {
  guide: `${DOCS}/USER_GUIDE.md`,
  shortcuts: `${DOCS}/USER_GUIDE.md#keyboard-shortcuts`,
  twoFactor: `${DOCS}/USER_GUIDE.md#two-step-verification`,
  importExport: `${DOCS}/USER_GUIDE.md#import-and-export`,
  offline: `${DOCS}/USER_GUIDE.md#offline-and-the-app`,
  backups: `${DOCS}/BACKUP_RESTORE.md`,
  troubleshooting: `${DOCS}/TROUBLESHOOTING.md`,
  changes: `${REPO}/blob/v${APP_VERSION}/CHANGELOG.md`,
} as const;

/** Served by Memora itself: the licences of the software it includes (scripts/licenses.mjs). */
export const LICENSES_URL = '/third-party-licenses.txt';

/** Opens a guide in a new tab, without giving it a handle on this one. */
export const openHelp = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');
