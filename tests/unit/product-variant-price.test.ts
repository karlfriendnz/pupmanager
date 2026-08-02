import { describe, it, expect } from 'vitest'
import {
  effectivePriceCents,
  isOnSale,
  productPriceSummary,
  resolveVariantPricing,
  variantPriceCents,
} from '@/lib/product-price'

// Price INHERITANCE is the rule the whole variant feature rests on: five sizes
// of one harness at one price should be typed once, on the product, and every
// screen that shows a variant's price has to arrive at the same number as the
// route that charges for it. So it lives in one helper, and this pins it.

const PRODUCT = { priceCents: 4500, salePriceCents: null }

describe('resolveVariantPricing', () => {
  it('a variant with no price of its own costs what the product costs', () => {
    expect(variantPriceCents(PRODUCT, { priceCents: null, salePriceCents: null })).toBe(4500)
  })

  it('a variant with its own price overrides the product', () => {
    expect(variantPriceCents(PRODUCT, { priceCents: 6000, salePriceCents: null })).toBe(6000)
  })

  it('inherits the product’s SALE price, so putting the product on sale puts every size on sale', () => {
    const p = { priceCents: 4500, salePriceCents: 2900 }
    expect(variantPriceCents(p, { priceCents: null, salePriceCents: null })).toBe(2900)
    expect(isOnSale(resolveVariantPricing(p, { priceCents: null, salePriceCents: null }))).toBe(true)
  })

  it('one size can be on sale on its own', () => {
    expect(variantPriceCents(PRODUCT, { priceCents: null, salePriceCents: 3900 })).toBe(3900)
  })

  it('setting your own price opts you out of the product’s sale', () => {
    // The trap: product £45 marked down to £29, and the Large priced £60. A
    // flat inherited sale would sell the Large for £29 — less than the Small,
    // off a base price the sale was never set against.
    const p = { priceCents: 4500, salePriceCents: 2900 }
    const resolved = resolveVariantPricing(p, { priceCents: 6000, salePriceCents: null })
    expect(resolved.salePriceCents).toBeNull()
    expect(effectivePriceCents(resolved)).toBe(6000)
  })

  it('a sale that doesn’t undercut the price is not a sale', () => {
    const resolved = resolveVariantPricing(PRODUCT, { priceCents: 3000, salePriceCents: 3000 })
    expect(resolved.salePriceCents).toBeNull()
    expect(effectivePriceCents(resolved)).toBe(3000)
  })

  it('leaves an EXPLICIT sale price alone — that one was typed on purpose', () => {
    const resolved = resolveVariantPricing(PRODUCT, { priceCents: 6000, salePriceCents: 5000 })
    expect(effectivePriceCents(resolved)).toBe(5000)
  })

  it('no variant at all is just the product’s own pricing', () => {
    expect(effectivePriceCents(resolveVariantPricing({ priceCents: 4500, salePriceCents: 2900 }, null))).toBe(2900)
  })

  it('an unpriced product with unpriced variants stays unpriced', () => {
    expect(variantPriceCents({ priceCents: null, salePriceCents: null }, { priceCents: null })).toBeNull()
  })
})

describe('productPriceSummary', () => {
  it('reports a product with no variants as its own single price — unchanged', () => {
    expect(productPriceSummary(PRODUCT, [])).toEqual({
      count: 0, from: 4500, to: 4500, varies: false,
    })
  })

  it('five sizes at the inherited price are ONE price, not a range', () => {
    const variants = Array.from({ length: 5 }, () => ({ priceCents: null, salePriceCents: null }))
    expect(productPriceSummary(PRODUCT, variants)).toMatchObject({ count: 5, from: 4500, to: 4500, varies: false })
  })

  it('gives the cheapest and dearest when the sizes disagree', () => {
    const summary = productPriceSummary(PRODUCT, [
      { priceCents: null, salePriceCents: null }, // 4500, inherited
      { priceCents: 6000, salePriceCents: null },
      { priceCents: 3000, salePriceCents: null },
    ])
    expect(summary).toMatchObject({ count: 3, from: 3000, to: 6000, varies: true })
  })

  it('ignores hidden options — "3 options" has to mean three a client can pick', () => {
    const summary = productPriceSummary(PRODUCT, [
      { priceCents: 3000, salePriceCents: null, active: true },
      { priceCents: 1000, salePriceCents: null, active: false },
    ])
    expect(summary).toMatchObject({ count: 1, from: 3000, varies: false })
  })

  it('says "from" when some options have a price and others have none', () => {
    // "$20" would be a lie about the unpriced one; "from $20" is not.
    const summary = productPriceSummary({ priceCents: null, salePriceCents: null }, [
      { priceCents: 2000, salePriceCents: null },
      { priceCents: null, salePriceCents: null },
    ])
    expect(summary).toMatchObject({ count: 2, from: 2000, varies: true })
  })
})
