import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** What the app remembers between launches, beside the notes (desktop.json). */
export interface DesktopSettings {
  /** The port Memora listens on: kept, so the window's address stays the same. */
  port?: number;
  bounds?: { x: number; y: number; width: number; height: number; maximized: boolean };
}

const file = () => path.join(app.getPath('userData'), 'desktop.json');

export function readSettings(): DesktopSettings {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as DesktopSettings;
  } catch {
    return {};
  }
}

export function saveSettings(patch: Partial<DesktopSettings>): void {
  const next = { ...readSettings(), ...patch };
  mkdirSync(path.dirname(file()), { recursive: true });
  // Written beside it and renamed over it: a crash never leaves half a file.
  writeFileSync(`${file()}.tmp`, JSON.stringify(next, null, 2));
  renameSync(`${file()}.tmp`, file());
}
