import type { ReactNode } from 'react';

/** A link to a guide, opening in a new tab. Its text says where it goes. */
export function HelpLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-accent underline-offset-2 hover:underline"
    >
      {children}
    </a>
  );
}
