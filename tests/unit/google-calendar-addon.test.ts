import { describe, it, expect } from 'vitest'
import { addonById, isFreeAddon, isSellableAddon, isAddonId } from '@/lib/pricing'

// Google Calendar is a FREE add-on: it gates the Settings → Google Calendar tab,
// toggles without Stripe, and must never appear at checkout.
describe('google calendar add-on', () => {
  it('is a known add-on', () => {
    expect(isAddonId('googlecalendar')).toBe(true)
    expect(addonById('googlecalendar')?.name).toBe('Google Calendar')
  })

  it('is free — toggles without Stripe and is not sellable', () => {
    expect(isFreeAddon('googlecalendar')).toBe(true)
    expect(isSellableAddon('googlecalendar')).toBe(false)
    const prices = Object.values(addonById('googlecalendar')!.price)
    expect(prices.every((p) => p === 0)).toBe(true)
  })

  it('is not on by default (off until the trainer turns it on)', () => {
    expect(addonById('googlecalendar')?.defaultOn).toBeFalsy()
  })
})
