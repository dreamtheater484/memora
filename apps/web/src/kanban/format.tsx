import type { Priority } from '@memora/shared';
import { ChevronsUp, ChevronUp, Equal, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/* How cards' priorities and dates are shown. */

export const PRIORITY: Record<Priority, { label: string; icon: ReactNode; className: string }> = {
  urgent: { label: 'Urgent', icon: <TriangleAlert />, className: 'text-danger' },
  high: { label: 'High', icon: <ChevronsUp />, className: 'text-[oklch(0.62_0.17_45)]' },
  medium: { label: 'Medium', icon: <ChevronUp />, className: 'text-[oklch(0.68_0.14_85)]' },
  low: { label: 'Low', icon: <Equal />, className: 'text-fg-3' },
  none: { label: 'No priority', icon: null, className: '' },
};

const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** A `YYYY-MM-DD` date, short. */
export const shortDate = (date: string) => dayFormat.format(new Date(`${date}T12:00:00`));
