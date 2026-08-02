// Can THIS phone take a tap?
//
// Country and Stripe setup are the server's business (see terminal.ts and the
// /api/terminal routes). This file is the other half, and the server can never
// answer it: whether the thing in the trainer's hand has an NFC radio, a recent
// enough OS, and a secure element Apple will talk to.
//
// It is deliberately pure — no Capacitor import, no `window` — so the rules can
// be unit-tested, and so the same rules can be quoted back in a settings screen
// rendered on a desktop where none of them apply.
//
// WHY BOTHER, when the Stripe SDK will refuse anyway? Because the SDK refuses at
// the tap, and by then the trainer is standing in front of a customer with a
// card out. Every refusal here happens before the button is drawn, and every one
// of them names the actual reason. The single most common case is the honest,
// permanent one: an iPad has no NFC hardware at all and never will, and the
// trainer using our app on an iPad deserves to be told that once rather than
// discovering it at a class.

/** Why this device can't tap. `null` in the support result means it can. */
export type TapToPayDeviceReason =
  /** A browser. Tap to Pay is a native capability; there is no web fallback. */
  | 'NOT_NATIVE'
  /** iPad — no NFC reader in any model. Permanent, not a "not yet". */
  | 'NO_NFC'
  /** iPhone 8 / X and older: no secure element Apple will use. iPhone XS is the floor. */
  | 'DEVICE_TOO_OLD'
  /** Right phone, old OS. Fixable by the trainer in Settings → General. */
  | 'OS_TOO_OLD'
  /** Simulator/emulator. Apple and Google both refuse; only a real handset works. */
  | 'SIMULATOR'

export interface TapToPayDeviceInfo {
  /** What Capacitor's `getPlatform()` says. */
  platform: string
  /** Capacitor Device `model` — "iPhone", "iPad", or an Android model string. */
  model?: string | null
  /** Capacitor Device `osVersion` — "17.4.1", "13". */
  osVersion?: string | null
  /** Capacitor Device `isVirtual` — simulator or emulator. */
  isVirtual?: boolean | null
}

export interface TapToPayDeviceSupport {
  supported: boolean
  reason: TapToPayDeviceReason | null
}

/**
 * iOS 16.4 is Stripe's documented floor for Tap to Pay on iPhone. Apple's own
 * ProximityReader arrived in 16.0, but Stripe's Terminal SDK requires 16.4 and
 * it is Stripe's SDK we are calling.
 */
export const MIN_IOS_MAJOR = 16
export const MIN_IOS_MINOR = 4

/**
 * Android 13 (API 33). Stripe's Tap to Pay on Android needs 13+, Google Play
 * Services, and an NFC radio. We can see the OS version here; NFC is the
 * plugin's own capability check, because a model string is a terrible way to ask
 * whether a radio exists.
 */
export const MIN_ANDROID_MAJOR = 13

/** Parse a leading "17.4.1" into [17, 4]. Missing or unparseable → null. */
function parseVersion(value: string | null | undefined): [number, number] | null {
  if (!value) return null
  const match = /^(\d+)(?:\.(\d+))?/.exec(value.trim())
  if (!match) return null
  return [Number(match[1]), match[2] ? Number(match[2]) : 0]
}

/**
 * The rules, in the order they should be told to a trainer: the permanent ones
 * first, so nobody is sent to update an iPad that was never going to work.
 *
 * An UNRECOGNISED device is allowed through on purpose. This function is a way
 * to give a good answer early, not the authority — the authority is the Stripe
 * SDK's own capability check on the device. Guessing "no" from a model string we
 * don't recognise would eventually hide the feature from a phone that supports
 * it perfectly well, and that failure is silent, which is the worst kind.
 */
export function tapToPayDeviceSupport(info: TapToPayDeviceInfo): TapToPayDeviceSupport {
  const platform = info.platform?.toLowerCase()

  if (platform !== 'ios' && platform !== 'android') {
    return { supported: false, reason: 'NOT_NATIVE' }
  }

  const model = info.model?.trim() ?? ''

  if (platform === 'ios') {
    // UIDevice reports the family, so "iPad" is exact and cheap to check.
    if (/ipad/i.test(model)) return { supported: false, reason: 'NO_NFC' }
    if (info.isVirtual) return { supported: false, reason: 'SIMULATOR' }

    // When the shell reports a hardware identifier ("iPhone11,2") rather than
    // the family, we can rule out the pre-XS handsets outright. iPhone11,x is
    // the XS/XS Max/XR generation — the first with the secure element Apple
    // requires — so anything below 11 is a permanent no.
    const identifier = /^iphone(\d+),/i.exec(model)
    if (identifier && Number(identifier[1]) < 11) {
      return { supported: false, reason: 'DEVICE_TOO_OLD' }
    }

    const version = parseVersion(info.osVersion)
    if (version) {
      const [major, minor] = version
      if (major < MIN_IOS_MAJOR || (major === MIN_IOS_MAJOR && minor < MIN_IOS_MINOR)) {
        return { supported: false, reason: 'OS_TOO_OLD' }
      }
    }
    return { supported: true, reason: null }
  }

  // Android. Tap to Pay refuses to run on an emulator, and a rooted or
  // developer-options device is refused by Stripe at connect time — we can't see
  // either from here, so the emulator is the only one we can catch early.
  if (info.isVirtual) return { supported: false, reason: 'SIMULATOR' }

  const version = parseVersion(info.osVersion)
  if (version && version[0] < MIN_ANDROID_MAJOR) {
    return { supported: false, reason: 'OS_TOO_OLD' }
  }
  return { supported: true, reason: null }
}

/**
 * One plain sentence per reason, for the trainer.
 *
 * They are written to be READ BY THE PERSON WHO IS STUCK, so each says what is
 * true and, where there is one, what to do. None of them says "unsupported
 * device", which tells nobody anything.
 */
export function tapToPayDeviceMessage(reason: TapToPayDeviceReason): string {
  switch (reason) {
    case 'NOT_NATIVE':
      return 'Tap to Pay only works in the PupManager app on your phone, not in a web browser.'
    case 'NO_NFC':
      return 'iPads can’t read cards — there’s no contactless reader in them. You’ll need an iPhone XS or newer.'
    case 'DEVICE_TOO_OLD':
      return 'This iPhone is too old to read cards. Tap to Pay needs an iPhone XS or newer.'
    case 'OS_TOO_OLD':
      return 'Your phone’s software is too old for Tap to Pay. Update it, then come back to this screen.'
    case 'SIMULATOR':
      return 'Tap to Pay can’t run on a simulator — it needs a real phone with a contactless reader.'
  }
}
