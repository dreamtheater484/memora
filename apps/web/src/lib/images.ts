/*
 * Optional downscaling of pasted and dropped images (§9.5), off by default: the longest side
 * is limited, photos are stored as WebP, and screenshots (PNG) stay lossless PNG. Animated
 * GIFs and anything the browser can't draw are kept as they are.
 */

export interface ImageOptions {
  downscaleImages: boolean;
  maxImageEdge: number;
}

export interface Prepared {
  blob: Blob;
  name: string;
}

const PHOTO = new Set(['image/jpeg', 'image/webp', 'image/avif']);

const renamed = (name: string, extension: string) =>
  `${name.replace(/\.[a-z0-9]{1,5}$/i, '') || 'image'}.${extension}`;

/** The file to keep: as it is, or smaller. */
export async function prepareImage(
  file: Blob,
  name: string,
  options: ImageOptions,
): Promise<Prepared> {
  const kept = { blob: file, name };
  const photo = PHOTO.has(file.type);
  if (!options.downscaleImages || (!photo && file.type !== 'image/png')) return kept;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return kept;
  }
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, options.maxImageEdge / longest);
    // A screenshot that already fits stays exactly as it is.
    if (scale === 1 && !photo) return kept;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return kept;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);
    const type = photo ? 'image/webp' : 'image/png';
    const blob = await canvas.convertToBlob(photo ? { type, quality: 0.85 } : { type });
    // Some browsers can't write WebP and fall back to PNG: keep the original then.
    if (blob.type !== type || (scale === 1 && blob.size >= file.size)) return kept;
    return { blob, name: renamed(name, photo ? 'webp' : 'png') };
  } finally {
    bitmap.close();
  }
}
