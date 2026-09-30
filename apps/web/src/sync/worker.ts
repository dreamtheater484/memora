import { toast } from '../components/ui/toast-store';

/*
 * The service worker that keeps the app on the device (production builds only), and the
 * prompt when a new version of Memora is ready (§9.6, Phase 11). A new version waits until
 * the user chooses to reload, or until every tab has closed.
 */

/** How often an open app looks for a new version. */
const CHECK_MS = 60 * 60_000;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void watchUpdates(navigator.serviceWorker, () => window.location.reload());
  });
}

/** Registers the service worker and offers each new version (exported for the tests). */
export async function watchUpdates(
  container: ServiceWorkerContainer,
  reload: () => void,
): Promise<void> {
  let updating = false;
  let reloaded = false;
  let controlled = !!container.controller;
  const offer = (waiting: ServiceWorker) =>
    toast({
      title: 'A new version of Memora is ready',
      description: 'Reload to use it. What you typed is kept.',
      duration: Infinity,
      action: {
        label: 'Reload',
        onClick: () => {
          updating = true;
          waiting.postMessage({ type: 'SKIP_WAITING' });
        },
      },
    });
  container.addEventListener('controllerchange', () => {
    // The first version taking over a first visit: not an update.
    if (!controlled) {
      controlled = true;
      return;
    }
    if (reloaded) return;
    if (updating) {
      reloaded = true;
      reload();
    } else {
      // Another tab updated: this one still runs the old version.
      toast({
        title: 'Memora was updated in another tab',
        description: 'Reload to use the new version.',
        duration: Infinity,
        action: { label: 'Reload', onClick: reload },
      });
    }
  });
  let registration: ServiceWorkerRegistration;
  try {
    registration = await container.register('/sw.js');
  } catch {
    return;
  }
  // A version already waiting from an earlier visit.
  if (registration.waiting && container.controller) offer(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      // Installed while an older version controls the page: an update, not a first visit.
      if (installing.state === 'installed' && container.controller) offer(installing);
    });
  });
  setInterval(() => void registration.update().catch(() => undefined), CHECK_MS);
}
