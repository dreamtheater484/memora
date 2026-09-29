import type { VersionReason } from '@memora/shared';

/** Why a version was kept, as the history lists it. */
export const REASON: Record<VersionReason, string> = {
  auto: 'Edited',
  manual: 'Saved by hand',
  conversion: 'Before converting',
  import: 'Imported',
  restore: 'Before restoring',
  conflict: 'Kept from a conflict',
};

const time = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' });

/** "14:05" */
export const formatTime = (ms: number): string => time.format(ms);
