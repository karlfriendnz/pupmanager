import Foundation
import Capacitor
import StripeTerminal

// Tap to Pay on iPhone — the iOS half of the bridge described in
// src/lib/tap-to-pay-native.ts.
//
// WHY THIS FILE EXISTS AT ALL. Stripe ships iOS, Android and React Native SDKs
// but no Capacitor one, so any route to Tap to Pay goes through somebody's
// wrapper. This is that wrapper, and it is deliberately about forty lines of
// real work around Stripe's own SDK: five methods, no reader-discovery UI, no
// payment types we don't sell. Depending on Stripe's surface — versioned,
// documented, and the thing Apple audits — is a much better place to stand than
// a community package sitting between us and a trainer's money.
//
// EVERY CALL IS AGAINST THE TRAINER'S CONNECTED ACCOUNT. Nothing here names an
// account: the connection token the server mints carries it, so this file
// cannot connect a reader to the wrong business even if it wanted to. Same for
// the location — it arrives with the token rather than being chosen here.
//
// WHAT THIS FILE MUST NEVER DO is decide an amount, a fee, or whether a payment
// succeeded. It authorises a card and hands the result back. The capture is a
// server call, and the sale is settled by the Connect webhook.

@objc(TapToPayPlugin)
public class TapToPayPlugin: CAPPlugin, CAPBridgedPlugin, ConnectionTokenProvider, DiscoveryDelegate {

    public let identifier = "TapToPayPlugin"
    public let jsName = "TapToPay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "collect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "provideConnectionToken", returnType: CAPPluginReturnPromise)
    ]

    /// The JS side answers `connectionTokenRequested` by calling
    /// `provideConnectionToken`, so the SDK's synchronous-looking callback has
    /// to be parked here until that arrives.
    private var pendingTokenCompletion: ConnectionTokenCompletionBlock?
    /// The trainer's Terminal Location, learned from the same token response.
    private var locationId: String?
    private var discoverCancelable: Cancelable?
    private var collectCancelable: Cancelable?
    private var connectCall: CAPPluginCall?

    override public func load() {
        // Stripe wants its token provider before anything else touches
        // `Terminal.shared`. Setting it in load() means the very first
        // `isSupported` call is already able to authenticate.
        Terminal.setTokenProvider(self)
    }

    // MARK: - Connection tokens

    public func fetchConnectionToken(_ completion: @escaping ConnectionTokenCompletionBlock) {
        // Stripe asks for a token at connect AND again during a long session,
        // which is exactly why this is an event rather than an argument: a
        // token handed in once would work for a single tap and then quietly
        // stop mid-afternoon.
        pendingTokenCompletion = completion
        notifyListeners("connectionTokenRequested", data: [:])
    }

    @objc func provideConnectionToken(_ call: CAPPluginCall) {
        guard let completion = pendingTokenCompletion else {
            // Nothing is waiting — an answer to a request that already timed
            // out. Dropping it is correct; failing the call would surface a
            // scary error for something harmless.
            call.resolve()
            return
        }
        pendingTokenCompletion = nil

        if let secret = call.getString("secret") {
            // The location rides along with the token so that JS never gets to
            // choose which location a reader connects to.
            if let location = call.getString("locationId") { self.locationId = location }
            completion(secret, nil)
        } else {
            let message = call.getString("error") ?? "Could not reach PupManager"
            completion(nil, NSError(domain: "PupManagerTapToPay", code: 1,
                                    userInfo: [NSLocalizedDescriptionKey: message]))
        }
        call.resolve()
    }

    // MARK: - Capability

    @objc func isSupported(_ call: CAPPluginCall) {
        // Stripe's own check is the authority here, not a model string. It
        // knows about the secure element, the entitlement in this binary, and
        // whether Apple's terms have been accepted for the account the token
        // belongs to — none of which JS can see.
        let supported = Terminal.shared.supportsReaders(
            of: .tapToPay,
            discoveryMethod: .tapToPay,
            simulated: false
        )
        switch supported {
        case .success:
            call.resolve(["supported": true])
        case .failure(let error):
            call.resolve(["supported": false, "reason": error.localizedDescription])
        }
    }

    // MARK: - Connecting this phone as a reader

    @objc func connect(_ call: CAPPluginCall) {
        if Terminal.shared.connectionStatus == .connected {
            // Idempotent on purpose. A trainer who taps twice, or a second sale
            // in the same session, must not tear down a live reader.
            call.resolve(["connected": true])
            return
        }
        guard let locationId = self.locationId else {
            // Should be impossible — the token request that precedes this one
            // carries the location — but failing loudly beats connecting a
            // reader to nowhere.
            call.reject("No Terminal location. PupManager could not be reached.")
            return
        }

        connectCall = call
        notifyStage("connecting")

        let config = TapToPayDiscoveryConfigurationBuilder()
        discoverCancelable = Terminal.shared.discoverReaders(
            (try? config.build()) ?? TapToPayDiscoveryConfiguration(),
            delegate: self
        ) { [weak self] error in
            guard let self else { return }
            if let error {
                self.connectCall?.reject(error.localizedDescription, nil, error)
                self.connectCall = nil
                self.notifyStage("failed")
            }
        }
        self.pendingLocationId = locationId
    }

    private var pendingLocationId: String?

    public func terminal(_ terminal: Terminal, didUpdateDiscoveredReaders readers: [Reader]) {
        // On this discovery method there is exactly one reader: this phone.
        guard let reader = readers.first, let locationId = pendingLocationId else { return }
        discoverCancelable?.cancel { _ in }
        discoverCancelable = nil

        let connectionConfig = try? TapToPayConnectionConfigurationBuilder(delegate: nil, locationId: locationId).build()
        Terminal.shared.connectReader(reader, connectionConfig: connectionConfig!) { [weak self] _, error in
            guard let self else { return }
            if let error {
                self.notifyStage("failed")
                self.connectCall?.reject(error.localizedDescription, nil, error)
            } else {
                self.notifyStage("ready")
                self.connectCall?.resolve(["connected": true])
            }
            self.connectCall = nil
        }
    }

    // MARK: - The tap

    @objc func collect(_ call: CAPPluginCall) {
        guard let clientSecret = call.getString("clientSecret") else {
            call.reject("Missing clientSecret")
            return
        }

        // The intent was created SERVER-side, with the amount and our fee on
        // it. Retrieving it by secret means the phone never chooses either.
        Terminal.shared.retrievePaymentIntent(clientSecret: clientSecret) { [weak self] intent, error in
            guard let self else { return }
            if let error {
                call.reject(error.localizedDescription, nil, error)
                return
            }
            guard let intent else {
                call.reject("That sale could not be found.")
                return
            }

            self.notifyStage("waiting_for_card")
            let collectConfig = try? CollectConfigurationBuilder().build()
            self.collectCancelable = Terminal.shared.collectPaymentMethod(
                intent,
                collectConfig: collectConfig
            ) { collected, collectError in
                self.collectCancelable = nil
                if let collectError {
                    self.notifyStage("failed")
                    call.reject(collectError.localizedDescription, nil, collectError)
                    return
                }
                guard let collected else {
                    self.notifyStage("failed")
                    call.reject("The card wasn’t read.")
                    return
                }

                self.notifyStage("processing")
                // AUTHORISES ONLY. The intent is manual-capture, so the money
                // does not move until the server captures it — see
                // src/app/api/terminal/capture/route.ts for why that split is
                // the safety in the whole design.
                Terminal.shared.confirmPaymentIntent(collected) { confirmed, confirmError in
                    if let confirmError {
                        self.notifyStage("failed")
                        call.reject(confirmError.localizedDescription, nil, confirmError)
                        return
                    }
                    self.notifyStage("done")
                    call.resolve([
                        "paymentIntentId": confirmed?.stripeId ?? "",
                        "status": String(describing: confirmed?.status ?? .requiresPaymentMethod)
                    ])
                }
            }
        }
    }

    @objc func cancel(_ call: CAPPluginCall) {
        // Close the NFC field. Leaving it open is how a phone in a pocket ends
        // up reading the next card that comes near it.
        collectCancelable?.cancel { _ in }
        collectCancelable = nil
        discoverCancelable?.cancel { _ in }
        discoverCancelable = nil
        call.resolve()
    }

    private func notifyStage(_ stage: String) {
        notifyListeners("tapToPayStatus", data: ["stage": stage])
    }
}
