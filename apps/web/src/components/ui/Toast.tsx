import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { Toast as T } from 'radix-ui';
import { cn } from '../../lib/cn';
import { useToasts } from './toast-store';

const TONE_ICON = {
  neutral: null,
  success: <CircleCheck className="size-4 shrink-0 text-ok" />,
  error: <CircleAlert className="size-4 shrink-0 text-danger" />,
};

/**
 * Renders the toasts. Mount once near the root. Bottom centre, above the phone
 * bottom bar (set --toast-offset on an ancestor to move it up).
 */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <T.Provider swipeDirection="down" label="Notifications">
      {toasts.map((t) => (
        <T.Root
          key={t.id}
          duration={t.duration ?? (t.action ? 8000 : 5000)}
          onOpenChange={(open) => !open && dismiss(t.id)}
          className={cn(
            'pointer-events-auto flex w-max max-w-full animate-pop-in items-center gap-3 rounded-lg py-2.5 pr-2 pl-3.5',
            'bg-fg text-sm text-bg shadow-pop',
            'data-[swipe=move]:translate-y-(--radix-toast-swipe-move-y) data-[swipe=end]:animate-fade-in',
          )}
        >
          {TONE_ICON[t.tone ?? 'neutral']}
          <div className="min-w-0">
            <T.Title className="font-semibold">{t.title}</T.Title>
            {t.description && <T.Description className="text-bg/75">{t.description}</T.Description>}
          </div>
          {t.action && (
            <T.Action
              altText={t.action.label}
              onClick={t.action.onClick}
              className="ml-1 h-7 rounded-full px-2.5 text-xs font-semibold text-bg underline-offset-2 hover:bg-bg/15"
            >
              {t.action.label}
            </T.Action>
          )}
          <T.Close
            aria-label="Dismiss"
            className="grid size-7 place-items-center rounded-full text-bg/70 hover:bg-bg/15 hover:text-bg"
          >
            <X className="size-4" />
          </T.Close>
        </T.Root>
      ))}
      <T.Viewport className="pointer-events-none fixed bottom-[calc(1.25rem+var(--toast-offset,0px)+env(safe-area-inset-bottom))] left-1/2 z-[60] flex w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 flex-col items-center gap-2 outline-none" />
    </T.Provider>
  );
}
