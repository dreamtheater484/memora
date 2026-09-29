import { describe, expect, it } from 'vitest';
import { pngOf } from '../test/images';
import { sniffImage, storedType } from './image';

function jpegOf(width: number, height: number): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(9, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(4)]);
}

function gifOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'latin1');
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
}

function webpOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBPVP8X', 8, 'latin1');
  b.writeUIntLE(width - 1, 24, 3);
  b.writeUIntLE(height - 1, 27, 3);
  return b;
}

describe('image detection', () => {
  it('reads the type and size from the file itself', () => {
    expect(sniffImage(pngOf(640, 480))).toEqual({ mime: 'image/png', width: 640, height: 480 });
    expect(sniffImage(jpegOf(1920, 1080))).toEqual({
      mime: 'image/jpeg',
      width: 1920,
      height: 1080,
    });
    expect(sniffImage(gifOf(16, 9))).toEqual({ mime: 'image/gif', width: 16, height: 9 });
    expect(sniffImage(webpOf(3000, 2000))).toEqual({
      mime: 'image/webp',
      width: 3000,
      height: 2000,
    });
    expect(sniffImage(Buffer.from('hello'))).toBeNull();
  });

  it('never trusts a claimed image type', () => {
    expect(storedType(Buffer.from('<script>alert(1)</script>'), 'image/png').mime).toBe(
      'application/octet-stream',
    );
    expect(storedType(pngOf(1, 1), 'text/html').mime).toBe('image/png');
    expect(storedType(Buffer.from('%PDF-1.7'), 'application/pdf').mime).toBe('application/pdf');
    expect(storedType(Buffer.from('<svg/>'), 'image/svg+xml').mime).toBe('image/svg+xml');
    expect(storedType(Buffer.from('x'), 'not a type').mime).toBe('application/octet-stream');
  });
});
