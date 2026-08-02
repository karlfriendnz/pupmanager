'use client'

import { useEffect, useState } from 'react'
import { nativePlatform } from '@/lib/native'
import {
  tapToPayDeviceSupport,
  tapToPayDeviceMessage,
  type TapToPayDeviceReason,
} from '@/lib/tap-to-pay-device'
import { tapToPayPluginAvailable } from '@/lib/tap-to-pay-native'

// "Can this trainer, on this phone, take a card by tapping it?"
//
// Four separate authorities have to agree, and each of them can say no for a
// completely different reason:
//
//   the BUSINESS  country, Stripe onboarding, the pos add-on   → the server
//   the PHONE     NFC, secure element, OS version              → tap-to-pay-device
//   the BUILD     is the native plugin in this app binary      → the plugin itself
//   APPLE         has this merchant accepted Apple's terms     → the server
//
// They are combined HERE, once, so that no screen has to remember all four and
// none of them can be quietly forgotten in a new one. Every no comes back with
// a sentence written for the trainer, because a hidden button and a broken
// button are equally useless and this feature's whole risk is failing in front
// of a paying customer.

export type TapToPayServerReason = 'COUNTRY_UNSUPPORTED' | 'ADDON_REQUIRED' | 'PAYMENTS_REQUIRED'

export interface TapToPayEligibility {
  eligible: boolean
  reason: TapToPayServerReason | null
  country: string
  platforms: { ios: boolean; android: boolean }
  terms: { accepted: boolean; linked: boolean }
  merchantName: string | null
}

export interface TapToPayState {
  /** Still working it out. Show nothing rather than flickering a wrong answer. */
  loading: boolean
  /** Draw the row at all? False for a browser, an iPad, a build without the plugin. */
  offer: boolean
  /** Can they tap RIGHT NOW, no steps left? */
  ready: boolean
  /** The one step left: Apple's terms. `offer` is still true — this is a row to show, not hide. */
  needsAppleTerms: boolean
  /** One sentence, for the trainer, when something is wrong. */
  message: string | null
  /** The name the cardholder will read off the phone. Theirs, never ours. */
  merchantName: string | null
}

const SERVER_MESSAGES: Record<TapToPayServerReason, string> = {
  // Named, not "your country" — a South African trainer should get a real
  // answer rather than a shrug, because this one will never change for them.
  COUNTRY_UNSUPPORTED:
    'Stripe doesn’t do in-person card payments in your country yet, so Tap to Pay isn’t available.',
  ADDON_REQUIRED: 'Turn on Instant sale in Settings → Add-ons to take payments in person.',
  PAYMENTS_REQUIRED: 'Finish setting up payments in Settings → Payments first.',
}

const IDLE: TapToPayState = {
  loading: true,
  offer: false,
  ready: false,
  needsAppleTerms: false,
  message: null,
  merchantName: null,
}

/**
 * `enabled` exists so the sale composer only asks when it is actually open. The
 * endpoint hits Stripe-adjacent state and this hook is mounted on screens a
 * trainer opens dozens of times a day.
 */
export function useTapToPay(enabled = true): TapToPayState {
  const [state, setState] = useState<TapToPayState>(IDLE)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    void (async () => {
      // THE PHONE FIRST, because it needs no network and settles most of the
      // nos. A desktop browser and an iPad never reach the server at all.
      const platform = nativePlatform()
      const device = tapToPayDeviceSupport({
        platform,
        model: deviceModelHint(),
        osVersion: osVersionHint(),
      })
      if (!device.supported) {
        if (!cancelled) {
          setState({
            loading: false,
            // NOT_NATIVE is the ordinary case — a trainer at a desk — and there
            // is nothing to say about it. The rest are worth a sentence.
            offer: false,
            ready: false,
            needsAppleTerms: false,
            message: device.reason === 'NOT_NATIVE' ? null : tapToPayDeviceMessage(device.reason as TapToPayDeviceReason),
            merchantName: null,
          })
        }
        return
      }

      // Is the plugin even in this binary? Tap to Pay ships in a store build, so
      // a trainer on last month's app has the screens but not the radio code.
      const plugin = await tapToPayPluginAvailable()
      if (cancelled) return
      if (!plugin) {
        setState({
          loading: false,
          offer: false,
          ready: false,
          needsAppleTerms: false,
          message: 'Update the PupManager app to take payments by tapping a card.',
          merchantName: null,
        })
        return
      }

      try {
        const res = await fetch('/api/terminal/eligibility')
        const data = (await res.json()) as TapToPayEligibility
        if (cancelled) return
        if (!res.ok || !data.eligible) {
          setState({
            loading: false,
            offer: false,
            ready: false,
            needsAppleTerms: false,
            message: data?.reason ? SERVER_MESSAGES[data.reason] : null,
            merchantName: null,
          })
          return
        }

        // The country lists differ per platform and Stripe maintains them
        // separately, so "eligible" is not enough — ask about THIS platform.
        const platformOk = platform === 'ios' ? data.platforms.ios : data.platforms.android
        if (!platformOk) {
          setState({
            loading: false,
            offer: false,
            ready: false,
            needsAppleTerms: false,
            message: 'Tap to Pay isn’t available on this kind of phone in your country yet.',
            merchantName: data.merchantName,
          })
          return
        }

        setState({
          loading: false,
          // Outstanding terms still OFFER the feature. They are one tap and a
          // web page, and hiding the row would leave a trainer with no way to
          // discover the one thing standing between them and using it.
          offer: true,
          ready: data.terms.accepted,
          needsAppleTerms: !data.terms.accepted,
          message: data.terms.accepted
            ? null
            : 'One step left: accept Apple’s terms for taking card payments. It takes a minute and you only do it once.',
          merchantName: data.merchantName,
        })
      } catch {
        if (!cancelled) setState({ ...IDLE, loading: false })
      }
    })()

    return () => { cancelled = true }
  }, [enabled])

  // Disabled reads as "still working it out" rather than as a stale yes. The
  // answer is kept in state across a close/reopen on purpose — it is the same
  // trainer on the same phone, so re-showing it while the check re-runs is the
  // right answer, not a guess.
  return enabled ? state : IDLE
}

/**
 * A best-effort model hint from the user agent.
 *
 * Capacitor's WebView user agent carries "iPad" on an iPad, which is the one
 * distinction worth making here and the one that matters most — the app runs
 * fine on an iPad and a trainer may well use one all day. Everything finer than
 * that (which iPhone, which Android) is left to the Stripe SDK's own capability
 * check, because a model string is a terrible way to ask whether a radio exists.
 */
function deviceModelHint(): string | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/iPad/i.test(ua)) return 'iPad'
  if (/iPhone/i.test(ua)) return 'iPhone'
  return null
}

/** "OS 17_4_1" / "Android 14" out of the user agent, normalised to "17.4.1". */
function osVersionHint(): string | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  const ios = /OS (\d+)[._](\d+)(?:[._](\d+))?/.exec(ua)
  if (ios) return [ios[1], ios[2], ios[3]].filter(Boolean).join('.')
  const android = /Android (\d+(?:\.\d+)?)/.exec(ua)
  if (android) return android[1]
  return null
}
