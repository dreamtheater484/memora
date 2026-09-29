import rootPackage from '../../../package.json' with { type: 'json' };

/** The Memora version, taken from the root package.json (inlined into the bundle at build time). */
export const APP_VERSION: string = rootPackage.version;
