/** Test files: just enough bytes to be recognised as images. */

/** A minimal PNG header: signature, then an IHDR chunk with the size. */
export function pngOf(width: number, height: number): Buffer {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  const ihdr = Buffer.alloc(17);
  ihdr.write('IHDR', 0, 'latin1');
  ihdr.writeUInt32BE(width, 4);
  ihdr.writeUInt32BE(height, 8);
  return Buffer.concat([head, ihdr, Buffer.alloc(8)]);
}
