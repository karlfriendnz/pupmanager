import { describe, it, expect } from 'vitest'
import {
  effectivePriceCents,
  isOnSale,
  savingCents,
  savingPercent,
  validateSalePrice,
} from '@/lib/product-price'

// A sale price is not decoration — it's the number charged. These are the rules
// every buy path (client shop checkout, pay-later invoice, trainer POS) leans on.
describe('effectivePriceCents', () => {
  it('is the sale price when one is set', () => {
    expect(effectivePriceCents({ priceCents: 4500, salePriceCents: 2900 })).toBe(2900)
  })

  it('is the normal price when there is no sale', () => {
    expect(effectivePriceCents({ priceCents: 4500, salePriceCents: null })).toBe(4500)
  })

  it('is null for an unpriced "contact trainer" product', () => {
    expect(effectivePriceCents({ priceCents: null, salePriceCents: null })).toBeNull()
  })

  it('treats a sale price of 0 as a real price, not as "unset"', () => {
    expect(effectivePriceCents({ priceCents: 4500, salePriceCents: 0 })).toBe(0)
  })

  it('survives an undefined salePriceCents (rows selected before the column existed)', () => {
    expect(effectivePriceCents({ priceCents: 4500 })).toBe(4500)
  })
})

describe('isOnSale / savings', () => {
  it('is a sale only when there is a higher normal price to strike through', () => {
    expect(isOnSale({ priceCents: 4500, salePriceCents: 2900 })).toBe(true)
    expect(isOnSale({ priceCents: 4500, salePriceCents: null })).toBe(false)
    expect(isOnSale({ priceCents: null, salePriceCents: 2900 })).toBe(false)
    expect(isOnSale({ priceCents: 2900, salePriceCents: 2900 })).toBe(false)
  })

  it('reports the saving in cents and whole percent', () => {
    expect(savingCents({ priceCents: 4500, salePriceCents: 2900 })).toBe(1600)
    expect(savingPercent({ priceCents: 4500, salePriceCents: 2900 })).toBe(36)
    expect(savingPercent({ priceCents: 4500, salePriceCents: null })).toBe(0)
  })
})

describe('validateSalePrice', () => {
  it('accepts a sale below the normal price', () => {
    expect(validateSalePrice(4500, 2900)).toBeNull()
  })

  it('accepts null — clearing it restores normal pricing', () => {
    expect(validateSalePrice(4500, null)).toBeNull()
    expect(validateSalePrice(null, null)).toBeNull()
  })

  it('rejects a sale at or above the normal price', () => {
    expect(validateSalePrice(4500, 4500)).toMatch(/less than the normal price/)
    expect(validateSalePrice(4500, 6000)).toMatch(/less than the normal price/)
  })

  it('rejects a sale on an unpriced product — there is nothing to discount', () => {
    expect(validateSalePrice(null, 2900)).toMatch(/normal price/)
  })

  it('rejects a negative sale price', () => {
    expect(validateSalePrice(4500, -1)).toMatch(/negative/)
  })
})
