import { z } from 'zod';
import { isHlc } from './hlc';

/*
 * The vault's files (ADR 0006, docs/SYNC_FORMAT.md). Every file is JSON, compressed and then
 * encrypted (crypto.ts); what comes out is checked against these schemas before anything uses
 * it, as it comes from outside this computer.
 */

export const FORMAT_VERSION = 1;

const hlc = z.string().refine(isHlc, 'not a clock');
const deviceId = z.string().regex(/^[0-9a-f-]{36}$/);

/** A column's value: SQLite's text, integers and reals, or null. */
const value = z.union([z.string().max(8_000_000), z.number(), z.null()]);

/**
 * One row's change: `put` sends the fields that changed (all of them when `full`, for a new
 * row), `del` deletes it. Snapshots also send each group's clock (`c`) and when the row was
 * added (`b`); a change's clock `h` covers what it doesn't say otherwise.
 */
export const changeSchema = z.object({
  t: z.string().regex(/^[a-z_]{1,64}$/),
  k: z
    .array(z.union([z.string().max(200), z.number()]))
    .min(1)
    .max(4),
  h: hlc,
  op: z.enum(['put', 'del']),
  full: z.boolean().optional(),
  f: z.record(z.string().max(200), value).optional(),
  c: z.record(z.string().max(200), hlc).optional(),
  b: hlc.optional(),
});
export type Change = z.infer<typeof changeSchema>;

/** `changes/<device>.<seq>.mchg`: what one computer changed, in order. */
export const batchSchema = z.object({
  v: z.number().int().min(1),
  device: deviceId,
  /** The computer's name when it wrote this, for conflict copies. */
  name: z.string().max(200),
  seq: z.number().int().min(1),
  at: z.number().int(),
  changes: z.array(changeSchema).max(200_000),
});
export type Batch = z.infer<typeof batchSchema>;

/**
 * `snapshots/<time>.<device>.<part>.msnap`: everything one computer had, in parts. Each part says
 * which changes of each computer the snapshot includes, and the last part that it is the last.
 */
export const snapshotSchema = z.object({
  v: z.number().int().min(1),
  device: deviceId,
  at: z.number().int(),
  part: z.number().int().min(0).max(100_000),
  /** The snapshot's last part: one without it isn't complete. */
  last: z.boolean(),
  /** The last change of each computer that the snapshot includes. */
  cursors: z.record(deviceId, z.number().int().min(0)),
  changes: z.array(changeSchema).max(500_000),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/** `devices/<device>.mdev`: a computer that syncs with this folder, for the settings page. */
export const deviceSchema = z.object({
  v: z.number().int().min(1),
  id: deviceId,
  name: z.string().max(200),
  version: z.string().max(50),
  lastSeenAt: z.number().int(),
  seq: z.number().int().min(0),
});
export type DeviceRecord = z.infer<typeof deviceSchema>;

export const changesName = (device: string, seq: number) =>
  `${device}.${String(seq).padStart(10, '0')}.mchg`;
const changesPattern = /^([0-9a-f-]{36})\.(\d{10})\.mchg$/;

export function parseChangesName(name: string): { device: string; seq: number } | null {
  const match = changesPattern.exec(name);
  return match ? { device: match[1]!, seq: Number(match[2]) } : null;
}

export const snapshotName = (at: number, device: string, part: number) =>
  `${String(at).padStart(16, '0')}.${device}.${String(part).padStart(5, '0')}.msnap`;
const snapshotPattern = /^(\d{16})\.([0-9a-f-]{36})\.(\d{5})\.msnap$/;

export function parseSnapshotName(
  name: string,
): { at: number; device: string; part: number } | null {
  const match = snapshotPattern.exec(name);
  return match ? { at: Number(match[1]), device: match[2]!, part: Number(match[3]) } : null;
}

export const blobFileName = (name: string) => `${name}.mblob`;
export const deviceFileName = (device: string) => `${device}.mdev`;
const devicePattern = /^([0-9a-f-]{36})\.mdev$/;
export const parseDeviceName = (name: string) => devicePattern.exec(name)?.[1] ?? null;
