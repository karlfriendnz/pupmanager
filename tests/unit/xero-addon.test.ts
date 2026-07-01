import { describe, it, expect } from 'vitest'
import { addonById, isFreeAddon, isSellableAddon, isAddonId } from '@/lib/pricing'

// The Xero integration is a FREE add-on: it gates the Settings → Xero tab, toggles
// without Stripe, and must never appear at checkout.
describe('xero add-on', () => {
  it('is a known add-on', () => {
    expect(isAddonId('xero')).toBe(true)
    expect(addonById('xero')?.name).toBe('Xero')
  })

  it('is free — toggles without Stripe and is not sellable', () => {
    expect(isFreeAddon('xero')).toBe(true)
    expect(isSellableAddon('xero')).toBe(false)
    const prices = Object.values(addonById('xero')!.price)
    expect(prices.every((p) => p === 0)).toBe(true)
  })
})
