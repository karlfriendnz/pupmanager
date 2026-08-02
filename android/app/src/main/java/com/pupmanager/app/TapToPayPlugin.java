package com.pupmanager.app;

import androidx.annotation.NonNull;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.stripe.stripeterminal.Terminal;
import com.stripe.stripeterminal.external.callable.Callback;
import com.stripe.stripeterminal.external.callable.Cancelable;
import com.stripe.stripeterminal.external.callable.ConnectionTokenCallback;
import com.stripe.stripeterminal.external.callable.ConnectionTokenProvider;
import com.stripe.stripeterminal.external.callable.DiscoveryListener;
import com.stripe.stripeterminal.external.callable.PaymentIntentCallback;
import com.stripe.stripeterminal.external.callable.ReaderCallback;
import com.stripe.stripeterminal.external.models.ConnectionConfiguration;
import com.stripe.stripeterminal.external.models.ConnectionTokenException;
import com.stripe.stripeterminal.external.models.DiscoveryConfiguration;
import com.stripe.stripeterminal.external.models.PaymentIntent;
import com.stripe.stripeterminal.external.models.Reader;
import com.stripe.stripeterminal.external.models.TerminalException;

import java.util.List;

/**
 * Tap to Pay on Android — the mirror of ios/App/App/TapToPayPlugin.swift, and
 * the JS contract in src/lib/tap-to-pay-native.ts.
 *
 * <p>Everything said in the Swift file applies here: the connection token
 * carries the trainer's connected account and their Terminal location, so this
 * class cannot connect a reader to the wrong business; the intent is created
 * server-side, so the phone never chooses an amount or a fee; and confirming
 * only AUTHORISES — the capture is a server call, which is what makes a
 * crashed sale expire on its own instead of charging for nothing.
 *
 * <p>ANDROID IS PHASE TWO. It is written now so the two platforms cannot drift
 * apart in what they promise JS, but it is untested on hardware and Android
 * adds its own obstacles: Tap to Pay refuses to run with developer options on,
 * on a rooted device, on an emulator, or with a screen recorder or an overlay
 * active — which fights the ordinary debugging loop. See
 * docs/tap-to-pay-plan.md §8.
 */
@CapacitorPlugin(name = "TapToPay")
public class TapToPayPlugin extends Plugin implements ConnectionTokenProvider, DiscoveryListener {

    /**
     * Parked while JS goes and fetches a token. Stripe asks at connect AND
     * again during a long session, which is why the token is an event rather
     * than an argument to connect().
     */
    private ConnectionTokenCallback pendingTokenCallback;
    private String locationId;
    private Cancelable discoverCancelable;
    private Cancelable collectCancelable;
    private PluginCall connectCall;

    // ─── Connection tokens ───────────────────────────────────────────────────

    @Override
    public void fetchConnectionToken(@NonNull ConnectionTokenCallback callback) {
        pendingTokenCallback = callback;
        notifyListeners("connectionTokenRequested", new JSObject());
    }

    @PluginMethod
    public void provideConnectionToken(PluginCall call) {
        ConnectionTokenCallback callback = pendingTokenCallback;
        pendingTokenCallback = null;
        if (callback == null) {
            // An answer to a request that already timed out. Dropping it is
            // right; failing would show a scary error for something harmless.
            call.resolve();
            return;
        }

        String secret = call.getString("secret");
        if (secret != null) {
            String location = call.getString("locationId");
            if (location != null) this.locationId = location;
            callback.onSuccess(secret);
        } else {
            String message = call.getString("error", "Could not reach PupManager");
            callback.onFailure(new ConnectionTokenException(message));
        }
        call.resolve();
    }

    // ─── Capability ──────────────────────────────────────────────────────────

    @PluginMethod
    public void isSupported(PluginCall call) {
        JSObject result = new JSObject();
        try {
            // Stripe's own check is the authority: it knows about the NFC
            // radio, Google Play services, developer options, and whether this
            // build is allowed to take payments — none of which JS can see.
            boolean supported = Terminal.getInstance()
                .supportsReadersOfType(
                    com.stripe.stripeterminal.external.models.DeviceType.TAP_TO_PAY_DEVICE,
                    new DiscoveryConfiguration.TapToPayDiscoveryConfiguration(false)
                )
                .isSupported();
            result.put("supported", supported);
        } catch (Exception e) {
            // Terminal not initialised, or the SDK is simply not in this build.
            // Either way the honest answer is no.
            result.put("supported", false);
            result.put("reason", String.valueOf(e.getMessage()));
        }
        call.resolve(result);
    }

    // ─── Connecting this phone as a reader ───────────────────────────────────

    @PluginMethod
    public void connect(PluginCall call) {
        if (Terminal.getInstance().getConnectedReader() != null) {
            // Idempotent: a second sale in the same session must not tear down
            // a live reader.
            JSObject result = new JSObject();
            result.put("connected", true);
            call.resolve(result);
            return;
        }
        if (locationId == null) {
            call.reject("No Terminal location. PupManager could not be reached.");
            return;
        }

        connectCall = call;
        notifyStage("connecting");
        discoverCancelable = Terminal.getInstance().discoverReaders(
            new DiscoveryConfiguration.TapToPayDiscoveryConfiguration(false),
            this,
            new Callback() {
                @Override public void onSuccess() { /* readers arrive via onUpdateDiscoveredReaders */ }
                @Override public void onFailure(@NonNull TerminalException e) {
                    notifyStage("failed");
                    if (connectCall != null) { connectCall.reject(e.getErrorMessage(), e); connectCall = null; }
                }
            }
        );
    }

    @Override
    public void onUpdateDiscoveredReaders(@NonNull List<Reader> readers) {
        // On this discovery method there is exactly one reader: this phone.
        if (readers.isEmpty() || locationId == null) return;
        if (discoverCancelable != null) { discoverCancelable.cancel(noopCallback()); discoverCancelable = null; }

        Terminal.getInstance().connectReader(
            readers.get(0),
            new ConnectionConfiguration.TapToPayConnectionConfiguration(locationId),
            new ReaderCallback() {
                @Override public void onSuccess(@NonNull Reader reader) {
                    notifyStage("ready");
                    if (connectCall != null) {
                        JSObject result = new JSObject();
                        result.put("connected", true);
                        connectCall.resolve(result);
                        connectCall = null;
                    }
                }
                @Override public void onFailure(@NonNull TerminalException e) {
                    notifyStage("failed");
                    if (connectCall != null) { connectCall.reject(e.getErrorMessage(), e); connectCall = null; }
                }
            }
        );
    }

    // ─── The tap ─────────────────────────────────────────────────────────────

    @PluginMethod
    public void collect(final PluginCall call) {
        final String clientSecret = call.getString("clientSecret");
        if (clientSecret == null) { call.reject("Missing clientSecret"); return; }

        Terminal.getInstance().retrievePaymentIntent(clientSecret, new PaymentIntentCallback() {
            @Override public void onSuccess(@NonNull PaymentIntent intent) {
                notifyStage("waiting_for_card");
                collectCancelable = Terminal.getInstance().collectPaymentMethod(intent, new PaymentIntentCallback() {
                    @Override public void onSuccess(@NonNull PaymentIntent collected) {
                        collectCancelable = null;
                        notifyStage("processing");
                        // AUTHORISES ONLY — manual capture, settled by the server.
                        Terminal.getInstance().confirmPaymentIntent(collected, new PaymentIntentCallback() {
                            @Override public void onSuccess(@NonNull PaymentIntent confirmed) {
                                notifyStage("done");
                                JSObject result = new JSObject();
                                result.put("paymentIntentId", confirmed.getId());
                                result.put("status", String.valueOf(confirmed.getStatus()));
                                call.resolve(result);
                            }
                            @Override public void onFailure(@NonNull TerminalException e) {
                                notifyStage("failed");
                                call.reject(e.getErrorMessage(), e);
                            }
                        });
                    }
                    @Override public void onFailure(@NonNull TerminalException e) {
                        collectCancelable = null;
                        notifyStage("failed");
                        call.reject(e.getErrorMessage(), e);
                    }
                });
            }
            @Override public void onFailure(@NonNull TerminalException e) {
                call.reject(e.getErrorMessage(), e);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        // Close the NFC field. Leaving it open is how a phone in a pocket ends
        // up reading the next card that comes near it.
        if (collectCancelable != null) { collectCancelable.cancel(noopCallback()); collectCancelable = null; }
        if (discoverCancelable != null) { discoverCancelable.cancel(noopCallback()); discoverCancelable = null; }
        call.resolve();
    }

    private void notifyStage(String stage) {
        JSObject data = new JSObject();
        data.put("stage", stage);
        notifyListeners("tapToPayStatus", data);
    }

    private Callback noopCallback() {
        return new Callback() {
            @Override public void onSuccess() { }
            @Override public void onFailure(@NonNull TerminalException e) { }
        };
    }
}
