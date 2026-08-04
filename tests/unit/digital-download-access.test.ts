import { describe, it, expect } from 'vitest'
import { isPaidDigitalProduct, mayDownloadProduct } from '@/lib/product-price'

// Who gets handed the file. Two bugs came out of getting this wrong: the URL
// was serialised into the shop page for every client (C-4), and "paid" was read
// off whether the trainer could take cards, so a trainer who hadn't finished
// Stripe Connect gave away every priced PDF they sold (C-8).

const digital = (over: Record<string, unknown> = {}) =>
  ({ kind: 'DIGITAL', priceCents: 900, salePriceCents: null, ...over }) as never

describe('is this download something you have to pay for', () => {
  it('a priced digital product is', () => {
    expect(isPaidDigitalProduct(digital(), [])).toBe(true)
  })

  it('a free one is not — zero and unpriced both open', () => {
    expect(isPaidDigitalProduct(digital({ priceCents: 0 }), [])).toBe(false)
    expect(isPaidDigitalProduct(digital({ priceCents: null }), [])).toBe(false)
  })

  it('a physical product is never a download', () => {
    expect(isPaidDigitalProduct(digital({ kind: 'PHYSICAL' }), [])).toBe(false)
  })

  it('prices off the sale price, because that is what actually gets charged', () => {
    expect(isPaidDigitalProduct(digital({ priceCents: 900, salePriceCents: 0 }), [])).toBe(false)
  })

  it('takes the cheapest option when it has options', () => {
    const variants = [
      { priceCents: null, salePriceCents: null, active: true },
      { priceCents: 1500, salePriceCents: null, active: true },
    ] as never[]
    expect(isPaidDigitalProduct(digital({ priceCents: 900 }), variants)).toBe(true)
  })
})

describe('may this client open it', () => {
  it('not before they have bought it', () => {
    expect(mayDownloadProduct(digital(), [], false)).toBe(false)
  })

  it('yes once they have', () => {
    expect(mayDownloadProduct(digital(), [], true)).toBe(true)
  })

  it('a free download opens straight away', () => {
    expect(mayDownloadProduct(digital({ priceCents: 0 }), [], false)).toBe(true)
  })

  it('the trainer taking cards or not never enters into it', () => {
    // The whole of C-8: payments being off decides HOW a client pays — card now
    // or on the trainer's invoice — not whether they have to at all. There is
    // deliberately no acceptPayments argument to pass.
    expect(mayDownloadProduct.length).toBe(3)
    expect(mayDownloadProduct(digital(), [], false)).toBe(false)
  })
})
