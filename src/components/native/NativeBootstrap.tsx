'use client';

import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapacitorApp } from '@capacitor/app';

export function NativeBootstrap() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    if (Capacitor.getPlatform() === 'android') {
      StatusBar.setBackgroundColor({ color: '#2563eb' }).catch(() => {});
    }
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});

    document.documentElement.dataset.native = 'true';
    document.documentElement.dataset.nativePlatform = Capacitor.getPlatform();
  }, []);

  // The app uses server-side `auth()` only — there's no client SessionProvider —
  // so we detect login by hitting /api/auth/session. Registration runs on launch
  // and again whenever the app returns to foreground, which catches the case
  // where the user logged in via the web flow before opening the app.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (Capacitor.getPlatform() !== 'ios') return; // Android push uses FCM, not wired yet

    let registered = false;
    let cancelled = false;

    async function isLoggedIn(): Promise<boolean> {
      try {
        const r = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!r.ok) return false;
        const data = await r.json();
        return Boolean(data?.user);
      } catch {
        return false;
      }
    }

    async function tryRegister() {
      if (registered || cancelled) return;
      if (!(await isLoggedIn())) return;

      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') return;

      await PushNotifications.addListener('registration', async (token) => {
        try {
          await fetch('/api/devices/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token.value, platform: 'IOS' }),
          });
        } catch { /* swallowed — retry on next launch */ }
      });

      await PushNotifications.addListener('registrationError', () => {});

      // Deep-link tap handling: every push payload from the server includes a
      // `path` in its custom data. When the user taps the notification, we
      // navigate the WebView to that path so they land directly on the page
      // the notification was about (e.g. session detail for a notes reminder).
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const path = (action.notification.data as { path?: string } | undefined)?.path;
        if (typeof path === 'string' && path.startsWith('/')) {
          window.location.href = path;
        }
      });

      await PushNotifications.register();
      registered = true;
    }

    void tryRegister();

    const stateHandle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void tryRegister();
    });

    return () => {
      cancelled = true;
      void stateHandle.then(h => h.remove());
      PushNotifications.removeAllListeners().catch(() => {});
    };
  }, []);

  return null;
}
