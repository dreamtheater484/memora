import { APP_NAME } from '@memora/shared';
import { ShieldAlert, TriangleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Logo } from '../components/ui';

export interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Small print under the card. */
  footer?: ReactNode;
}

/** The screens before the app: setup, login and the forced password change. */
export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  const titleId = useId();
  return (
    <div className="aurora-bg flex h-full flex-col overflow-y-auto">
      <main className="m-auto flex w-full max-w-[26rem] flex-col gap-6 px-4 py-10">
        <div className="flex items-center justify-center gap-2.5 font-display text-2xl font-semibold tracking-tight">
          <Logo className="size-9" />
          {APP_NAME}
        </div>
        <section
          aria-labelledby={titleId}
          className="glass-raised rounded-2xl px-5 py-6 tablet:px-8 tablet:py-8"
        >
          <h1 id={titleId} className="font-display text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {description && <div className="mt-1.5 text-sm text-fg-2">{description}</div>}
          <div className="mt-6">{children}</div>
        </section>
        <InsecureConnectionNote />
        {footer && <div className="text-center text-xs text-fg-3">{footer}</div>}
      </main>
    </div>
  );
}

/**
 * Browsers only allow secure cookies, offline mode and clipboard images over HTTPS (D13).
 * Plain HTTP works for a first try on the local network, but says so.
 */
function InsecureConnectionNote() {
  if (window.isSecureContext) return null;
  return (
    <p className="flex gap-2.5 rounded-lg border border-warn/40 bg-warn/10 px-3.5 py-3 text-xs text-fg-2">
      <ShieldAlert className="mt-px size-4 shrink-0 text-warn" aria-hidden />
      <span>
        <strong className="font-semibold text-fg">This connection isn’t encrypted.</strong> Others
        on the network could read your password. Set up HTTPS before real use (see the setup guide).
      </span>
    </p>
  );
}

/** The error summary above a form's button; announced when it appears. */
export function FormError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex gap-2 rounded-md bg-danger/10 px-3 py-2.5 text-sm text-danger [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0"
    >
      <TriangleAlert aria-hidden />
      <span>{message}</span>
    </p>
  );
}
