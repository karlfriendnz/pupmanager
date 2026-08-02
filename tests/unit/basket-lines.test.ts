import { describe, it, expect } from 'vitest'
import {
  addBasketLine, basketCount, basketLineKey, basketSubtotalCents, checkoutFingerprint,
  removeBasketLine, setBasketQuantity, toRequestLines,
  type BasketClassLine, type BasketProductLine,
} from '@/lib/basket'

// The basket's arithmetic and identity, on their own. Everything the review
// screen and the checkout route rely on is here — if a line's key isn't stable
// the server's "this one went stale" points at nothing.

const harness = (over: Partial<BasketProductLine> = {}): BasketProductLine => ({
  kind: 'PRODUCT',
  productId: 'prod_1',
  variantId: null,
  quantity: 1,
  name: 'Front-clip harness',
  variantName: null,
  imageUrl: null,
  unitAmount: 4500,
  ...over,
})

const saturdays = (over: Partial<BasketClassLine> = {}): BasketClassLine => ({
  kind: 'CLASS',
  classRunId: 'run_1',
  type: 'DROP_IN',
  sessionIds: ['s1', 's2'],
  dogIds: ['dog_1'],
  ticketTierId: null,
  ticketQuantity: 1,
  name: 'Puppy Foundations',
  detail: 'Drop-in · 2 sessions',
  imageUrl: null,
  estimateCents: 6000,
  ...over,
})

describe('basket line identity', () => {
  it('the same product+variant is one line', () => {
    expect(basketLineKey(harness())).toBe(basketLineKey(harness({ quantity: 9 })))
  })

  it('two sizes of the same product are two lines', () => {
    expect(basketLineKey(harness({ variantId: 'v_s' }))).not.toBe(basketLineKey(harness({ variantId: 'v_l' })))
  })

  it('the key ignores the order sessions and dogs were picked in', () => {
    expect(basketLineKey(saturdays({ sessionIds: ['s2', 's1'] }))).toBe(basketLineKey(saturdays()))
  })

  it('a different set of sessions on the same class is a different line', () => {
    expect(basketLineKey(saturdays({ sessionIds: ['s1'] }))).not.toBe(basketLineKey(saturdays()))
  })
})

describe('adding', () => {
  it('adding the same product twice means two of it, not two rows', () => {
    const lines = addBasketLine(addBasketLine([], harness()), harness())
    expect(lines).toHaveLength(1)
    expect((lines[0] as BasketProductLine).quantity).toBe(2)
  })

  it('re-adding the same class REPLACES it — the wizard hands over the whole choice', () => {
    const lines = addBasketLine(addBasketLine([], saturdays()), saturdays({ estimateCents: 6000 }))
    expect(lines).toHaveLength(1)
    expect((lines[0] as BasketClassLine).estimateCents).toBe(6000)
  })

  it('a product and a class live side by side', () => {
    const lines = addBasketLine(addBasketLine([], harness()), saturdays())
    expect(lines).toHaveLength(2)
  })
})

describe('counting and totalling', () => {
  const mixed = [harness({ quantity: 3 }), saturdays()]

  it('counts product units but a class booking as one thing', () => {
    // 12 on the badge for one course booking would read as a mistake.
    expect(basketCount(mixed)).toBe(4)
  })

  it('totals units × price plus the class estimate', () => {
    expect(basketSubtotalCents(mixed)).toBe(4500 * 3 + 6000)
  })

  it('dropping a quantity to zero removes the line', () => {
    expect(setBasketQuantity([harness()], basketLineKey(harness()), 0)).toHaveLength(0)
  })

  it('removing by key leaves the rest alone', () => {
    expect(removeBasketLine(mixed, basketLineKey(harness()))).toEqual([saturdays()])
  })
})

describe('what gets sent to the server', () => {
  it('carries the choices and NOT the prices — the server re-prices everything', () => {
    const [product] = toRequestLines([harness({ variantId: 'v_l', quantity: 2 })])
    expect(product).toEqual({
      kind: 'PRODUCT', key: 'PRODUCT:prod_1:v_l', productId: 'prod_1', variantId: 'v_l', quantity: 2,
    })
    expect(JSON.stringify(product)).not.toContain('4500')
  })

  it('a class line carries its sessions, dogs and tier', () => {
    const [cls] = toRequestLines([saturdays()])
    expect(cls).toMatchObject({ classRunId: 'run_1', type: 'DROP_IN', sessionIds: ['s1', 's2'], dogIds: ['dog_1'] })
  })
})

describe('checkout fingerprint — the idempotency key', () => {
  const a = { kind: 'PRODUCT', unitAmount: 4500, quantity: 2, productId: 'p1', variantId: 'v1', intent: { productId: 'p1', quantity: 2 } }
  const b = { kind: 'CLASS_ENROLLMENT', unitAmount: 3000, quantity: 1, intent: { classRunId: 'r1', sessionId: 's1', dogId: null } }

  it('is the same however the lines are ordered', () => {
    expect(checkoutFingerprint([a, b])).toBe(checkoutFingerprint([b, a]))
  })

  it('is the same however the intent keys are ordered', () => {
    const flipped = { ...b, intent: { dogId: null, sessionId: 's1', classRunId: 'r1' } }
    expect(checkoutFingerprint([flipped])).toBe(checkoutFingerprint([b]))
  })

  it('changes when the amount, quantity or variant changes', () => {
    expect(checkoutFingerprint([{ ...a, unitAmount: 4600 }])).not.toBe(checkoutFingerprint([a]))
    expect(checkoutFingerprint([{ ...a, quantity: 3 }])).not.toBe(checkoutFingerprint([a]))
    expect(checkoutFingerprint([{ ...a, variantId: 'v2' }])).not.toBe(checkoutFingerprint([a]))
  })

  it('ignores the card-surcharge line createPaymentRecord appends', () => {
    // Otherwise a stored payment could never match the basket that made it, and
    // every double tap would raise a second one.
    const surcharge = { kind: 'PRODUCT', unitAmount: 210, quantity: 1, intent: { surcharge: true } }
    expect(checkoutFingerprint([a, b, surcharge])).toBe(checkoutFingerprint([a, b]))
  })
})
