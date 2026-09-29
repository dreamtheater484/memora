import { describe, expect, it } from 'vitest';
import { isUuidV7, uuidv7, uuidv7Timestamp } from './ids';

describe('uuidv7', () => {
  it('produces RFC 9562 version 7 identifiers', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isUuidV7(uuidv7())).toBe(true);
    }
  });

  it('encodes the creation time', () => {
    expect(uuidv7Timestamp('01992d6c-8c00-7abc-8def-0123456789ab')).toBe(0x01992d6c8c00);
    // Generation is monotonic across calls, so the timestamp can only be "now" or slightly later.
    const before = Date.now();
    const stamp = uuidv7Timestamp(uuidv7());
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp - before).toBeLessThan(1_000);
  });

  it('is unique and strictly increasing, even within one millisecond', () => {
    const fixed = Date.now() + 60_000;
    const ids = Array.from({ length: 10_000 }, () => uuidv7(fixed));
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('stays monotonic when the clock goes backwards', () => {
    const first = uuidv7(Date.now() + 120_000);
    const second = uuidv7(Date.now() - 120_000);
    expect(second > first).toBe(true);
  });
});
