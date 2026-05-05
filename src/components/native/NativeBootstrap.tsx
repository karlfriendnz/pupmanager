'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { PushNotifications } from '@capacitor/push-notifications';

export function NativeBootstrap() {
  const { status } = useSession();

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

  // Only register for push once the user is authenticated — the registration
  // endpoint requires a session, and asking for permission before login is
  // jarring UX.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (status !== 'authenticated') return;

    let cancelled = false;

    (async () => {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') return;

      await PushNotifications.addListener('registration', async (token) => {
        if (cancelled) return;
        try {
          await fetch('/api/devices/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: token.value,
              platform: Capacitor.getPlatform() === 'ios' ? 'IOS' : 'ANDROID',
            }),
          });
        } catch {
          // swallowed — next launch will retry on registration event
        }
      });

      await PushNotifications.addListener('registrationError', () => {
        // surfaced via Xcode logs; nothing user-actionable here
      });

      await PushNotifications.register();
    })();

    return () => {
      cancelled = true;
      PushNotifications.removeAllListeners().catch(() => {});
    };
  }, [status]);

  return null;
}
