import { z } from 'zod';

/*
 * Images and attachments (§7.3, §9.5). A file is stored once per user (by its SHA-256) and
 * referenced from a page as `asset:<id>`. The id is made by the browser, so a file pasted
 * offline has its place in the text before the server has it.
 */

/** How a page refers to a file: `![alt](asset:<id>)` or `[name](asset:<id>)`. */
export const ASSET_SCHEME = 'asset:';

/** Where the browser loads a file from. */
export const assetPath = (id: string): string => `/api/v1/assets/${id}`;

/** Longest file name kept. */
export const MAX_ASSET_NAME = 200;

/** Default upload limit in megabytes (`MEMORA_MAX_UPLOAD_MB`). */
export const DEFAULT_MAX_UPLOAD_MB = 25;

/**
 * Image types shown inside pages. Anything else, SVG included (it can carry scripts), is
 * only ever downloaded, never shown by the browser from Memora's address.
 */
export const INLINE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const;

export const isInlineImage = (mime: string): boolean =>
  (INLINE_IMAGE_TYPES as readonly string[]).includes(mime.toLowerCase());

/** `PUT /assets/:id?name=…`: the file itself is the body. */
export const assetUploadQuerySchema = z.object({
  name: z.string().trim().min(1).max(MAX_ASSET_NAME),
});

export interface AssetMeta {
  id: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  name: string;
  createdAt: number;
}

/** Ids of the files a Markdown text refers to. */
export function assetIdsIn(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(/\basset:([0-9a-f-]{36})\b/gi))
    ids.add(match[1]!.toLowerCase());
  return [...ids];
}
