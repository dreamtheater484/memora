/*
 * What an uploaded file really is (§9.5): image types are read from the file's first bytes,
 * never taken from what the browser claimed, because only real images are ever shown inline.
 * Widths and heights come from the image headers, so no image library is needed.
 */

export interface Sniffed {
  mime: string;
  width: number | null;
  height: number | null;
}

const startsWith = (data: Buffer, bytes: number[], at = 0) =>
  data.length >= at + bytes.length && bytes.every((b, i) => data[at + i] === b);

const ascii = (data: Buffer, at: number, text: string) =>
  data.length >= at + text.length && data.toString('latin1', at, at + text.length) === text;

function png(data: Buffer): Sniffed | null {
  if (!startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return null;
  const known = data.length >= 24 && ascii(data, 12, 'IHDR');
  return {
    mime: 'image/png',
    width: known ? data.readUInt32BE(16) : null,
    height: known ? data.readUInt32BE(20) : null,
  };
}

function gif(data: Buffer): Sniffed | null {
  if (!ascii(data, 0, 'GIF87a') && !ascii(data, 0, 'GIF89a')) return null;
  const known = data.length >= 10;
  return {
    mime: 'image/gif',
    width: known ? data.readUInt16LE(6) : null,
    height: known ? data.readUInt16LE(8) : null,
  };
}

function jpeg(data: Buffer): Sniffed | null {
  if (!startsWith(data, [0xff, 0xd8, 0xff])) return null;
  // Walk the segments to the first frame header (SOF0–SOF15, not DHT/JPG/DAC).
  let at = 2;
  while (at + 9 < data.length) {
    if (data[at] !== 0xff) break;
    const marker = data[at + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2;
      continue;
    }
    const length = data.readUInt16BE(at + 2);
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      return {
        mime: 'image/jpeg',
        height: data.readUInt16BE(at + 5),
        width: data.readUInt16BE(at + 7),
      };
    }
    at += 2 + length;
  }
  return { mime: 'image/jpeg', width: null, height: null };
}

function webp(data: Buffer): Sniffed | null {
  if (!ascii(data, 0, 'RIFF') || !ascii(data, 8, 'WEBP')) return null;
  const size = (width: number | null, height: number | null) => ({
    mime: 'image/webp',
    width,
    height,
  });
  if (ascii(data, 12, 'VP8 ') && data.length >= 30) {
    return size(data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff);
  }
  if (ascii(data, 12, 'VP8L') && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (ascii(data, 12, 'VP8X') && data.length >= 30) {
    return size(data.readUIntLE(24, 3) + 1, data.readUIntLE(27, 3) + 1);
  }
  return size(null, null);
}

function avif(data: Buffer): Sniffed | null {
  if (!ascii(data, 4, 'ftyp')) return null;
  const brand = data.toString('latin1', 8, 12);
  return brand === 'avif' || brand === 'avis'
    ? { mime: 'image/avif', width: null, height: null }
    : null;
}

/** The image type and size of `data`, or null when it isn't an image shown inline. */
export function sniffImage(data: Buffer): Sniffed | null {
  return png(data) ?? jpeg(data) ?? gif(data) ?? webp(data) ?? avif(data);
}

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;

/**
 * The type a file is stored with: the sniffed image type, or else the browser's claim when it
 * is well formed and not an image (a file claiming to be a PNG that isn't one is just bytes).
 */
export function storedType(data: Buffer, claimed: string | undefined): Sniffed {
  const image = sniffImage(data);
  if (image) return image;
  const type = (claimed ?? '').split(';')[0]!.trim().toLowerCase();
  // Other image types (SVG, say) keep their name but are only ever downloaded.
  const pretends = type.startsWith('image/') && type !== 'image/svg+xml';
  const usable = MIME.test(type) && !pretends ? type : 'application/octet-stream';
  return { mime: usable, width: null, height: null };
}
