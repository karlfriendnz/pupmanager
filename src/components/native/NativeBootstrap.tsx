'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { PushNotifications } from '@capacitor/push-notifications';
import { App as CapacitorApp } from '@capacitor/app';
import { Badge } from '@capawesome/capacitor-badge';

// Pull the user's true unread total from the server and write it to the app-icon
// badge. Called on launch, whenever the app returns to the foreground, and after
// a foreground push — so the number reflects reality and drops back to 0 once
// everything's read. The server stamps the SAME count on each push (see
// sendPush → unreadBadgeCountForUser), so the icon never disagrees with itself.
// Best-effort: the badge is cosmetic, so every failure is swallowed.
async function syncAppBadge() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const r = await fetch('/api/notifications/badge', { cache: 'no-store' });
    if (!r.ok) return;
    const { count } = await r.json();
    const n = Number(count) || 0;
    if (n > 0) await Badge.set({ count: n });
    else await Badge.clear();
  } catch {
    /* badge is cosmetic — never let it surface an error */
  }
}

export function NativeBootstrap() {
  const router = useRouter();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    // Headers are white/light, so the status bar needs dark text to be
    // legible. Style.Dark = dark glyphs in @capacitor/status-bar.
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    if (Capacitor.getPlatform() === 'android') {
      StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {});
    }
    // overlay:true lets the WebView extend full-screen so env(safe-area-inset-*)
    // returns real values. Each sticky/fixed nav already pads itself with the
    // matching inset — without overlay the WebView is clipped to the safe area
    // and `bottom: 0` lands above the home-indicator strip, leaving a white
    // gap underneath. Same story for the notch on top.
    StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});

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
          // Stash the APNs token so sign-out can deregister this exact device
          // (otherwise the token lingers and pushes keep arriving post-logout).
          try { window.localStorage.setItem('pm-push-token', token.value); } catch {}
          const res = await fetch('/api/devices/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token.value, platform: 'IOS' }),
          });
          if (!res.ok) {
            console.error('[native-push] register returned', res.status);
          }
        } catch (err) {
          // Network/parse error — registration will retry on next launch.
          // Log so the failure is visible in Sentry/console rather than
          // a silent "no devices registered" state in Settings.
          console.error('[native-push] register failed', err);
        }
      });

      await PushNotifications.addListener('registrationError', (err) => {
        console.error('[native-push] APNs registrationError', err);
      });

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

      // Foreground push delivery — iOS fires this when a notification
      // arrives while the user is actively in the app. We can't show
      // the system banner ourselves but we DO need to re-fetch the
      // server-rendered nav so the unread-count badge picks up the
      // new message immediately. router.refresh() recomputes the
      // (trainer|client)/layout server component without blowing
      // away client state on the current page.
      await PushNotifications.addListener('pushNotificationReceived', () => {
        router.refresh();
        // A push just arrived while foregrounded — the count moved, so re-read it.
        void syncAppBadge();
      });

      await PushNotifications.register();
      registered = true;
      // First paint of the badge once we're registered + logged in.
      void syncAppBadge();
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

  // Universal Links / Android App Links — when iOS or Android hands the
  // app an HTTPS URL (a magic-link tap from email, a share-sheet link
  // to a session, a deep link in a push payload that points at a web
  // URL), Capacitor fires `appUrlOpen` with the full URL. We navigate
  // the WebView to the path so the user lands on the right page inside
  // the app instead of being bounced out to Safari.
  //
  // Strip the origin before navigating: the WebView is already on
  // app.pupmanager.com (via the native-shell loader), so a
  // window.location.href to the full URL would force a reload of the
  // shell. window.location.assign with just the pathname+search keeps
  // us inside the same WebView session.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      try {
        const u = new URL(url);
        // Only follow links to our own origin — anything else is
        // either malformed or someone trying to navigate the app out
        // of its sandbox.
        if (u.hostname !== 'app.pupmanager.com') return;
        const target = u.pathname + (u.search || '') + (u.hash || '');
        window.location.assign(target);
      } catch (err) {
        // Malformed URL — log so we can spot bad deep-link payloads
        // from email or push notifications, instead of the tap going
        // silently nowhere.
        console.error('[native-deep-link] failed to parse url', url, err);
      }
    });
    return () => { void handle.then(h => h.remove()); };
  }, []);

  // Refetch Server Components whenever the app comes back to foreground.
  // iOS doesn't kill backgrounded apps — the WebView keeps the React
  // tree (and any Server-Component-rendered data) exactly as it was
  // when the trainer swiped away. Without this, "closing and reopening"
  // shows yesterday's dashboard. router.refresh() rebuilds the
  // current route's Server Components without blowing away client
  // state (form drafts, scroll positions). We track the previous
  // isActive value so we only refresh on the inactive → active
  // transition, not on the initial mount or on duplicate events.
  const wasActiveRef = useRef(true);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Sync the icon badge on first mount (app cold-launched into the foreground)
    // and on every background → foreground return below. Opening the app to read
    // messages is exactly when a stale badge should come down.
    void syncAppBadge();
    const handle = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive && !wasActiveRef.current) {
        router.refresh();
        void syncAppBadge();
      }
      wasActiveRef.current = isActive;
    });
    return () => { void handle.then(h => h.remove()); };
  }, [router]);

  return null;
}
