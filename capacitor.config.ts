import type { CapacitorConfig } from '@capacitor/cli';

// The native shell loads the bundled `public/native-shell/index.html` first.
// That file probes the network and redirects into the live web app, or shows
// an offline UI if it can't reach us. We intentionally don't set `server.url`
// — that would short-circuit the bundled loader and leave us with a blank
// WebView when the device is offline.
const REMOTE_HOST = 'app.pupmanager.com';

const config: CapacitorConfig = {
  appId: 'com.pupmanager.app',
  appName: 'PupManager',
  webDir: 'public/native-shell',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    // Allow the bundled loader to navigate into the live web origin.
    allowNavigation: [REMOTE_HOST],
  },
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
