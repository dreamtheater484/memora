import { create } from 'zustand';

/*
 * Installing Memora as an app (Phase 11). Chrome and Edge offer it with an event that can be
 * kept and used later, from a button; other browsers have their own menus for it.
 */

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  prompt: InstallPrompt | null;
  installed: boolean;
}

const standalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true);

export const useInstall = create<InstallState>()(() => ({ prompt: null, installed: standalone() }));

/** Listens for the browser's offer to install (call once, early). */
export function watchInstall(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    useInstall.setState({ prompt: event as InstallPrompt });
  });
  window.addEventListener('appinstalled', () =>
    useInstall.setState({ prompt: null, installed: true }),
  );
}

/** Shows the browser's install dialog; answers whether it was installed. */
export async function install(): Promise<boolean> {
  const prompt = useInstall.getState().prompt;
  if (!prompt) return false;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  useInstall.setState({ prompt: null });
  return outcome === 'accepted';
}
