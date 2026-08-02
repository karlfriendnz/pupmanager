package com.pupmanager.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * The origin the shell actually navigates to. Must stay in step with
     * {@code server.allowNavigation} in capacitor.config.ts — a mismatch means
     * the page loads with no plugin bridge, and the only symptom is that
     * "Tap to Pay isn't available on this phone", which reads like a hardware
     * problem.
     */
    private static final String APP_ORIGIN = "https://app.pupmanager.com";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins are registered BEFORE super.onCreate(), which is what builds
        // the bridge and the JS that declares them.
        registerPlugin(TapToPayPlugin.class);
        super.onCreate(savedInstanceState);

        // …and the bridge is taught about our remote origin AFTER, because it
        // does not exist until super.onCreate() has run. See RemoteOriginBridge
        // for why this is needed at all: Capacitor injects its plugin bridge
        // only for the base URL, so on app.pupmanager.com every plugin call
        // would otherwise fail with "not implemented on android".
        RemoteOriginBridge.inject(getBridge(), APP_ORIGIN);
    }
}
