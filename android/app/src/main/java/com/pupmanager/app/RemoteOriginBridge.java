package com.pupmanager.app;

import android.webkit.WebView;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.Bridge;
import com.getcapacitor.Logger;

import java.lang.reflect.Method;
import java.util.Collections;

/**
 * Makes Capacitor plugins work on the REMOTE origin this app actually loads.
 *
 * <h3>The bug, precisely</h3>
 *
 * Our Android shell does not bundle the site. It boots a small local loader
 * (webDir = public/native-shell) and then navigates to
 * {@code https://app.pupmanager.com}, which is listed in
 * {@code server.allowNavigation}. That navigation is allowed — but the plugin
 * bridge does not follow it.
 *
 * <p>Capacitor's {@code Bridge.loadWebView()} registers its JS with
 * {@code WebViewCompat.addDocumentStartJavaScript(webView, script,
 * Collections.singleton(allowedOrigin))}, and {@code allowedOrigin} is derived
 * from {@code appUrl} ALONE. With no {@code server.url} set, appUrl is
 * {@code https://localhost} — so the bridge is injected for localhost and for
 * nothing else. On {@code app.pupmanager.com} there is no
 * {@code window.Capacitor}, and every plugin call fails with "not implemented
 * on android".
 *
 * <p>iOS does not have this problem: it injects into any page, which is why
 * every existing plugin (push, status bar, Apple sign-in) has worked on iOS and
 * been quietly dead on Android. Capacitor issues
 * <a href="https://github.com/ionic-team/capacitor/issues/7454">#7454</a> (open)
 * and #5455 (closed, "not planned").
 *
 * <h3>The fix</h3>
 *
 * Register the SAME script for our remote origin as well.
 * {@code addDocumentStartJavaScript} can be called more than once with
 * different origin rules, so nothing is replaced or fought over — localhost
 * keeps working exactly as before and the remote origin gains the bridge.
 *
 * <h3>Why reflection, in a payments path</h3>
 *
 * The script is built by {@code Bridge.getJSInjector()}, which is private, and
 * it returns a package-private type. Rebuilding it ourselves from the public
 * {@code JSExport} helpers would mean copying the exact concatenation order out
 * of Capacitor's source and re-copying it on every upgrade — a silent drift we
 * would only discover when a plugin stopped working in production. Asking
 * Capacitor for its own script is the version-proof answer, and reflection is
 * the only way to ask.
 *
 * <p>The failure mode is bounded and safe. If Capacitor renames the method, the
 * catch logs and returns; the bridge simply isn't injected, so
 * {@code TapToPay.isSupported()} rejects, the JS reports the plugin as absent,
 * and the trainer is told to update the app instead of being shown a button
 * that fails. Nothing is charged and nothing is half-charged. Pinned to
 * Capacitor 8.3.x — the version to re-check this against on any upgrade.
 */
final class RemoteOriginBridge {

    private RemoteOriginBridge() { }

    /**
     * @param origins scheme + host, no path — e.g. "https://app.pupmanager.com".
     *                Must match {@code server.allowNavigation} in
     *                capacitor.config.ts, or a page will load with no bridge.
     */
    static void inject(Bridge bridge, String... origins) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            // An old System WebView. Capacitor falls back to rewriting HTML as
            // it is served, which it can only do for its own local server — so
            // there is genuinely nothing to do here, and Tap to Pay will report
            // itself unavailable on this handset.
            Logger.warn("TapToPay", "WebView too old for document-start scripts; plugins stay local-only");
            return;
        }

        String script = scriptFrom(bridge);
        if (script == null) return;

        WebView webView = bridge.getWebView();
        for (String origin : origins) {
            try {
                WebViewCompat.addDocumentStartJavaScript(webView, script, Collections.singleton(origin));
            } catch (IllegalArgumentException e) {
                Logger.error("TapToPay", "Bad origin rule: " + origin, e);
            }
        }
    }

    /** Capacitor's own bridge JS, asked for rather than reconstructed. */
    private static String scriptFrom(Bridge bridge) {
        try {
            Method getInjector = Bridge.class.getDeclaredMethod("getJSInjector");
            getInjector.setAccessible(true);
            Object injector = getInjector.invoke(bridge);
            if (injector == null) return null;
            Method getScript = injector.getClass().getDeclaredMethod("getScriptString");
            getScript.setAccessible(true);
            return (String) getScript.invoke(injector);
        } catch (ReflectiveOperationException e) {
            // Capacitor moved. Plugins stay unavailable on the remote origin,
            // the app keeps working, and the JS side reports "update the app"
            // rather than offering a button that cannot work.
            Logger.error("TapToPay", "Could not read Capacitor's bridge script — plugins unavailable remotely", e);
            return null;
        }
    }
}
