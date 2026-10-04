/*
 * A hybrid logical clock (ADR 0006): wall-clock milliseconds, a counter for changes within the
 * same millisecond (or while this computer's clock is behind one it has heard from), and the
 * device that made the change, so two computers never make the same value. Written as text of
 * fixed width, so clocks compare as strings: `0001791234567890:0000:<device>`.
 */

const MS = 16;
const COUNTER = 4;
const MAX_COUNTER = 10 ** COUNTER - 1;
/** A clock older than any real one, for rows from before sync. */
export const ZERO_HLC = '0000000000000000:0000:00000000';

const pattern = /^(\d{16}):(\d{4}):([0-9a-f-]{8,64})$/;

export function isHlc(value: unknown): value is string {
  return typeof value === 'string' && pattern.test(value);
}

/** Clocks from other computers are believed up to this far ahead of this one's own time. */
const MAX_DRIFT_MS = 24 * 3_600_000;

export class Hlc {
  private ms = 0;
  private counter = 0;

  constructor(
    private readonly device: string,
    private readonly now: () => number,
    last?: string | null,
  ) {
    if (last && isHlc(last)) this.observe(last);
  }

  /** A new clock for a change made here: later than every clock made or seen before. */
  tick(): string {
    const wall = this.now();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else if (this.counter < MAX_COUNTER) {
      this.counter += 1;
    } else {
      this.ms += 1;
      this.counter = 0;
    }
    return this.format();
  }

  /**
   * A new clock for a change made here to a row last changed at `clock`: after it, even when
   * that clock came from a computer whose time is far ahead (and wasn't taken in), so the
   * change here isn't lost to it everywhere else.
   */
  tickAfter(clock: string | null | undefined): string {
    const mine = this.tick();
    const match = clock ? pattern.exec(clock) : null;
    if (!match || mine > clock!) return mine;
    let ms = Number(match[1]);
    let counter = Number(match[2]) + 1;
    if (counter > MAX_COUNTER) {
      ms += 1;
      counter = 0;
    }
    return `${String(ms).padStart(MS, '0')}:${String(counter).padStart(COUNTER, '0')}:${this.device}`;
  }

  /** Takes in a clock from another computer, so the next change here comes after it. */
  observe(clock: string): void {
    const match = pattern.exec(clock);
    if (!match) return;
    const ms = Number(match[1]);
    // A computer whose clock is far ahead mustn't drag every later change with it.
    if (ms > this.now() + MAX_DRIFT_MS) return;
    const counter = Number(match[2]);
    if (ms > this.ms || (ms === this.ms && counter > this.counter)) {
      this.ms = ms;
      this.counter = counter;
    }
  }

  /** The latest clock, to keep between runs. */
  last(): string {
    return this.format();
  }

  private format(): string {
    return `${String(this.ms).padStart(MS, '0')}:${String(this.counter).padStart(COUNTER, '0')}:${this.device}`;
  }
}

/** The later of two clocks (either may be missing). */
export function later(a: string | null | undefined, b: string | null | undefined): string {
  const x = a ?? ZERO_HLC;
  const y = b ?? ZERO_HLC;
  return x > y ? x : y;
}
