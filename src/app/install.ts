import { useEffect, useState } from 'react';

/**
 * One-tap PWA install.
 * Chrome, Edge and Samsung Internet fire `beforeinstallprompt` when the site is installable;
 * we keep that event so the "Install the app" button can open the browser's own install dialog.
 * iPhone/iPad Safari never fires it (Apple allows only Share → Add to Home Screen), and it does not
 * fire inside an embedded preview frame. Then the button shows the manual steps instead.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  installed = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export type InstallResult = 'accepted' | 'dismissed' | 'unavailable';

export async function promptInstall(): Promise<InstallResult> {
  if (!deferred) return 'unavailable';
  const evt = deferred;
  deferred = null; // the event can be used only once
  notify();
  await evt.prompt();
  const { outcome } = await evt.userChoice;
  return outcome;
}

export function useInstallState() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return { canPrompt: !!deferred, installed };
}
