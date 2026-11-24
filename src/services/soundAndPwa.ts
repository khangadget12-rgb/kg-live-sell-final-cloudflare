import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    install,
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return isOnline;
}

let sharedAudioContext: AudioContext | null = null;
let audioWasUnlockedByUser = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioCtx();
  }
  return sharedAudioContext;
}

function scheduleNotificationTone(ctx: AudioContext): void {
  const now = ctx.currentTime;
  const notes = [660, 880];
  notes.forEach((frequency, index) => {
    const startAt = now + index * 0.12;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.24);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + 0.25);
  });
}

/** Must be called directly from a user click/tap to satisfy autoplay policies. */
export async function enableNotificationAudio(playTestTone = true): Promise<boolean> {
  const ctx = getAudioContext();
  if (!ctx) return false;
  try {
    await ctx.resume();
    audioWasUnlockedByUser = ctx.state === 'running';
    if (audioWasUnlockedByUser && playTestTone) scheduleNotificationTone(ctx);
    return audioWasUnlockedByUser;
  } catch {
    audioWasUnlockedByUser = false;
    return false;
  }
}

export function playNotificationSound(enabled: boolean): void {
  if (!enabled || !audioWasUnlockedByUser) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'running') {
    scheduleNotificationTone(ctx);
    return;
  }
  // A previously unlocked context can be suspended when the device sleeps.
  // Resume is attempted, but browsers may still require another user gesture.
  void ctx.resume().then(() => {
    if (ctx.state === 'running') scheduleNotificationTone(ctx);
  }).catch(() => undefined);
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return await Notification.requestPermission();
}

/**
 * Resolve the app's service-worker registration. The Vite PWA plugin normally
 * registers /sw.js; explicitly registering it here is a safe fallback for
 * browsers where the automatic registration script was not injected.
 */
async function getNotificationRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    let registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    }

    // A registration can exist before its worker is active. `ready` waits for
    // an active worker, which is required for reliable showNotification calls.
    const readyRegistration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 8000)),
    ]);
    registration = readyRegistration || registration;
    if (!registration?.active) return null;
    return registration;
  } catch (error) {
    console.warn('KG Live Sell service worker is not ready:', error);
    return null;
  }
}

/** Uses ServiceWorkerRegistration.showNotification for desktop and mobile PWAs. */
export async function triggerBrowserNotification(title: string, body: string, tag?: string): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return false;
  const options: NotificationOptions = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: tag || `kg-live-sell-${Date.now()}`,
    renotify: false,
    silent: false,
    requireInteraction: true,
    timestamp: Date.now(),
    data: { url: '/' },
  };

  const registration = await getNotificationRegistration();
  if (registration) {
    try {
      await registration.showNotification(title, options);
      return true;
    } catch (error) {
      console.warn('Service-worker notification failed:', error);
    }
  }

  // Desktop fallback only. Most mobile browsers require showNotification().
  if (!/android|iphone|ipad|ipod/i.test(navigator.userAgent)) {
    try {
      new Notification(title, options);
      return true;
    } catch (error) {
      console.warn('Desktop notification failed:', error);
    }
  }
  return false;
}
