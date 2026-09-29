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

const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

/** "2:05 PM" */
export const formatTime = (ms: number): string => time.format(ms);
