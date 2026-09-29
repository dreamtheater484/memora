import { cn } from '../../lib/cn';

/** The Memora mark: a notebook with two tabs, tinted by the current section. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden className={cn('size-[1.625rem] shrink-0', className)}>
      <rect x="5" y="2.5" width="8.5" height="7" rx="2.2" fill="var(--logo-t1)" />
      <rect x="14.8" y="4" width="7.2" height="6" rx="2" fill="var(--logo-t2)" />
      <rect x="2.5" y="7" width="23" height="18.5" rx="5.5" fill="var(--accent)" />
      <path
        d="M8.6 20.2v-7.4l5.4 4.6 5.4-4.6v7.4"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
