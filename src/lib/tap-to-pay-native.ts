import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'

// The JS half of the native Tap to Pay bridge.
//
// WHY OUR OWN PLUGIN, and not `@capacitor-community/stripe-terminal`. Stripe
// ships iOS, Android and React Native SDKs but no Capacitor one, so any route
// here goes through somebody's wrapper. Writing the wrapper ourselves is about
// forty lines of Swift and Kotlin around Stripe's own SDK, and it means the
// surface we depend on is Stripe's — which is versioned, documented and not
// going anywhere — rather than a community package that would sit between us
// and the money. It also lets the surface be exactly this: five methods, no
// reader discovery UI, no payment types we don't sell.
//
// THE TOKEN FLOW IS AN EVENT, NOT AN ARGUMENT. Stripe's SDKs take a
// ConnectionTokenProvider they call whenever they need a fresh token — at
// connect, and again during a long session. So the native side raises
// `connectionTokenRequested` and this file answers it by calling our own
// endpoint with the trainer's session cookie. Passing a token into connect()
// instead would work for exactly one tap and then quietly stop.
//
// Nothing here decides whether Tap to Pay is ALLOWED — that is the server's job
// (see /api/terminal/eligibility) and the device's (tap-to-pay-device.ts). This
// file only knows how to talk to the radio.

/** What the native side reports while a tap is in progress. */
export type TapToPayStage =
  | 'connecting'
  | 'ready'
  | 'waiting_for_card'
  | 'processing'
  | 'done'
  | 'failed'

export interface TapToPayStatusEvent {
  stage: TapToPayStage
  /** Apple/Google's own words for what the cardholder should do, when they give us any. */
  message?: string
}

export interface TapToPayNativePlugin {
  /**
   * Does this handset actually have what Stripe needs? Answered by the Stripe
   * SDK's own capability check, which is the only authority — an NFC radio, a
   * secure element, terms accepted, no developer options, not an emulator.
   */
  isSupported(): Promise<{ supported: boolean; reason?: string }>

  /**
   * Connect the phone itself as a reader, at the trainer's Terminal Location.
   * Idempotent: a second call with the same location resolves against the live
   * connection rather than tearing it down mid-sale.
   */
  connect(options: { locationId: string }): Promise<{ connected: boolean }>

  /**
   * Hold the field open, take the tap, and confirm the PaymentIntent. Resolves
   * once the card has been AUTHORISED — the capture is the server's, so this
   * resolving is not yet money in the trainer's account.
   */
  collect(options: { clientSecret: string }): Promise<{ paymentIntentId: string; status: string }>

  /** Stop waiting for a card. Safe to call when nothing is in progress. */
  cancel(): Promise<void>

  /** Hand back a connection token the native SDK asked for. */
  provideConnectionToken(options: { secret?: string; error?: string }): Promise<void>

  addListener(
    eventName: 'connectionTokenRequested',
    listener: () => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'tapToPayStatus',
    listener: (event: TapToPayStatusEvent) => void,
  ): Promise<PluginListenerHandle>
}

/**
 * `registerPlugin` is safe to call on the web and during SSR — it returns a
 * proxy, and only an actual method call rejects. So this can live at module
 * scope in a file the browser bundle imports.
 */
export const TapToPayNative = registerPlugin<TapToPayNativePlugin>('TapToPay')

/** Is the native implementation actually present in this build? */
export async function tapToPayPluginAvailable(): Promise<boolean> {
  try {
    await TapToPayNative.isSupported()
    return true
  } catch {
    // Web, or a native build made before the plugin was added. Both mean "no",
    // and neither is an error worth showing a trainer.
    return false
  }
}

/**
 * Answer the native side's token requests for as long as the returned handle
 * lives. Start this BEFORE connect() — Stripe asks for a token during connect,
 * and a listener registered afterwards misses the only request that matters.
 *
 * On failure it tells the native side about the failure rather than staying
 * silent. A silent provider leaves Stripe's SDK hanging until it times out,
 * which reaches the trainer as a spinner that never stops.
 */
export async function serveConnectionTokens(): Promise<PluginListenerHandle> {
  return TapToPayNative.addListener('connectionTokenRequested', () => {
    void (async () => {
      try {
        const res = await fetch('/api/terminal/connection-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const data = (await res.json().catch(() => null)) as { secret?: string; error?: string } | null
        if (res.ok && data?.secret) await TapToPayNative.provideConnectionToken({ secret: data.secret })
        else await TapToPayNative.provideConnectionToken({ error: data?.error ?? 'Could not reach PupManager' })
      } catch {
        await TapToPayNative.provideConnectionToken({ error: 'No connection' }).catch(() => {})
      }
    })()
  })
}
