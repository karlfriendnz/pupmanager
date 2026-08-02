import { describe, it, expect } from 'vitest'
import { tapToPayDeviceSupport, tapToPayDeviceMessage } from '@/lib/tap-to-pay-device'

// Whether the phone in the trainer's hand can read a card.
//
// The whole point of these rules is TIMING. Stripe's SDK would refuse all of
// these too, but it refuses at the tap — with a customer standing there holding
// a card out. Every case below is caught before the button is drawn, and each
// one names the real reason rather than "unsupported device".

describe('devices that can never do this', () => {
  it('refuses an iPad, because no iPad has an NFC reader', () => {
    // The app runs perfectly well on an iPad and a trainer may well use one all
    // day, so this is the single most likely disappointment.
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPad', osVersion: '18.0' })).toEqual({
      supported: false,
      reason: 'NO_NFC',
    })
  })

  it('refuses an iPhone X and older — the secure element Apple needs starts at XS', () => {
    // iPhone10,3 is the X. iPhone11,2 is the XS.
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPhone10,3', osVersion: '16.7' }).reason)
      .toBe('DEVICE_TOO_OLD')
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPhone11,2', osVersion: '16.7' }).supported)
      .toBe(true)
  })

  it('refuses a browser outright — there is no web Tap to Pay', () => {
    expect(tapToPayDeviceSupport({ platform: 'web' }).reason).toBe('NOT_NATIVE')
  })

  it('refuses a simulator, which Apple and Google both do too', () => {
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPhone', osVersion: '18.0', isVirtual: true }).reason)
      .toBe('SIMULATOR')
    expect(tapToPayDeviceSupport({ platform: 'android', model: 'sdk_gphone64', osVersion: '14', isVirtual: true }).reason)
      .toBe('SIMULATOR')
  })
})

describe('devices that just need updating', () => {
  it('refuses iOS below 16.4, which is Stripe\'s floor', () => {
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPhone', osVersion: '16.3.1' }).reason).toBe('OS_TOO_OLD')
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPhone', osVersion: '15.7' }).reason).toBe('OS_TOO_OLD')
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPhone', osVersion: '16.4' }).supported).toBe(true)
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPhone', osVersion: '17' }).supported).toBe(true)
  })

  it('refuses Android below 13', () => {
    expect(tapToPayDeviceSupport({ platform: 'android', model: 'Pixel 4a', osVersion: '12' }).reason).toBe('OS_TOO_OLD')
    expect(tapToPayDeviceSupport({ platform: 'android', model: 'Pixel 7', osVersion: '13' }).supported).toBe(true)
  })

  it('tells an iPad owner about the iPad, not about the OS', () => {
    // Ordering: the permanent problem has to win, or a trainer is sent to
    // update an iPad that was never going to work.
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPad', osVersion: '15.0' }).reason).toBe('NO_NFC')
  })
})

describe('what we do NOT know', () => {
  it('lets an unrecognised phone through, because the SDK is the authority', () => {
    // Guessing "no" from a model string we do not recognise hides the feature
    // from a phone that supports it perfectly well — and hides it SILENTLY,
    // which nobody would ever report as a bug.
    expect(tapToPayDeviceSupport({ platform: 'ios', model: 'iPhone', osVersion: null }).supported).toBe(true)
    expect(tapToPayDeviceSupport({ platform: 'android', model: null, osVersion: null }).supported).toBe(true)
  })
})

describe('the sentences a trainer reads', () => {
  it('says what is true and, where there is one, what to do', () => {
    expect(tapToPayDeviceMessage('NO_NFC')).toContain('iPhone XS')
    expect(tapToPayDeviceMessage('OS_TOO_OLD')).toContain('Update')
    expect(tapToPayDeviceMessage('NOT_NATIVE')).toContain('app on your phone')
  })

  it('never uses the words "unsupported device", which tell nobody anything', () => {
    const all = (['NOT_NATIVE', 'NO_NFC', 'DEVICE_TOO_OLD', 'OS_TOO_OLD', 'SIMULATOR'] as const)
      .map(tapToPayDeviceMessage)
    for (const message of all) {
      expect(message.toLowerCase()).not.toContain('unsupported')
      expect(message.length).toBeGreaterThan(20)
    }
  })
})
