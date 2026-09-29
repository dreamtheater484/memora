import { ASSET_SCHEME, type AssetMeta, type FetchAssetRequest } from '@memora/shared';
import { api } from './api';

/*
 * Images in pasted HTML point at other websites; the server downloads them (§9.5, with the
 * SSRF protections of §11), so a page never depends on an outside address. Needs a connection;
 * when a download fails the image keeps pointing at the website and the user is told.
 */

/** Downloads a web image into the user's files; answers its `asset:` address. */
export async function downloadImage(url: string): Promise<string> {
  const meta = await api<AssetMeta>('POST', '/assets/fetch', { url } satisfies FetchAssetRequest);
  return `${ASSET_SCHEME}${meta.id}`;
}

/** Web addresses of images, as a page may hold them before they are downloaded. */
export const isWebImage = (src: string): boolean => /^https?:\/\//i.test(src);

/** At most this many images from one paste are downloaded. */
export const MAX_PASTED_DOWNLOADS = 30;
