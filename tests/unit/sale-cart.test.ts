import { describe, it, expect } from 'vitest'

// The instant-sale cart, as arithmetic. The composer is a three-step wizard
// whose cart survives stepping back and forth, so every mutation is a pure
// function over a plain array — which is exactly what these lock down.
import {
  MAX_LINE_QUANTITY,
  PRODUCT_SEARCH_THRESHOLD,
  addProductToLines,
  cartTotalCents,
  filterProducts,
  lineTotalCents,
  matchesProductQuery,
  parseAmountToCents,
  productLineKey,
  quantityInCart,
  removeLine,
  sellableProducts,
  setLineQuantity,
  shouldOfferProductSearch,
  type SaleLine,
  type SaleProduct,
} from '@/lib/sale-cart'

const product = (over: Partial<SaleProduct> = {}): SaleProduct => ({
  id: 'p1',
  name: 'Ball thrower',
  priceCents: 2500,
  salePriceCents: null,
  imageUrl: null,
  active: true,
  xeroAccountCode: null,
  ...over,
})

const line = (over: Partial<SaleLine> = {}): SaleLine => ({
  key: 'p_p1',
  description: 'Ball thrower',
  quantity: 1,
  unitAmountCents: 2500,
  ...over,
})

describe('what can be sold', () => {
  it('keeps active, priced products', () => {
    const rows = sellableProducts([product()])
    expect(rows).toHaveLength(1)
  })

  it('drops inactive, unpriced and zero-priced products', () => {
    const rows = sellableProducts([
      product({ id: 'a', active: false }),
      product({ id: 'b', priceCents: null }),
      product({ id: 'c', priceCents: 0 }),
      product({ id: 'd' }),
    ])
    expect(rows.map((p) => p.id)).toEqual(['d'])
  })

  // A product on sale is sellable at its sale price even when that's the only
  // usable number — an unpriced product with a sale price still has an amount.
  it('a sale price counts as a price', () => {
    const rows = sellableProducts([product({ priceCents: 4000, salePriceCents: 2000 })])
    expect(rows).toHaveLength(1)
  })
})

describe('searching the catalogue', () => {
  it('matches case-insensitively, anywhere in the name', () => {
    expect(matchesProductQuery({ name: 'Ball thrower' }, 'THROW')).toBe(true)
    expect(matchesProductQuery({ name: 'Ball thrower' }, 'lead')).toBe(false)
  })

  it('an empty or whitespace query matches everything', () => {
    expect(matchesProductQuery({ name: 'Ball thrower' }, '')).toBe(true)
    expect(matchesProductQuery({ name: 'Ball thrower' }, '   ')).toBe(true)
    const all = [product({ id: 'a' }), product({ id: 'b', name: 'Long lead' })]
    expect(filterProducts(all, '  ')).toHaveLength(2)
  })

  it('filters the list down', () => {
    const all = [product({ id: 'a' }), product({ id: 'b', name: 'Long lead' })]
    expect(filterProducts(all, 'lead').map((p) => p.id)).toEqual(['b'])
    expect(filterProducts(all, 'nothing here')).toEqual([])
  })

  // Search box only when the grid stops being scannable. A trainer with six
  // products should see six pictures, not an empty box above them.
  it('offers search only above the threshold', () => {
    expect(shouldOfferProductSearch(0)).toBe(false)
    expect(shouldOfferProductSearch(PRODUCT_SEARCH_THRESHOLD)).toBe(false)
    expect(shouldOfferProductSearch(PRODUCT_SEARCH_THRESHOLD + 1)).toBe(true)
  })
})

describe('adding products', () => {
  it('adds a new line at the sale price, carrying the Xero code', () => {
    const lines = addProductToLines([], product({ priceCents: 4000, salePriceCents: 2500, xeroAccountCode: '200' }))
    expect(lines).toEqual([{
      key: productLineKey('p1'),
      description: 'Ball thrower',
      quantity: 1,
      unitAmountCents: 2500,
      xeroAccountCode: '200',
    }])
  })

  it('tapping the same product again stacks the quantity rather than duplicating', () => {
    let lines = addProductToLines([], product())
    lines = addProductToLines(lines, product())
    lines = addProductToLines(lines, product())
    expect(lines).toHaveLength(1)
    expect(lines[0].quantity).toBe(3)
  })

  it('different products get their own lines', () => {
    let lines = addProductToLines([], product({ id: 'a' }))
    lines = addProductToLines(lines, product({ id: 'b', name: 'Long lead' }))
    expect(lines.map((l) => l.key)).toEqual(['p_a', 'p_b'])
  })

  it('never leaves the original array mutated', () => {
    const before: SaleLine[] = [line()]
    const after = addProductToLines(before, product())
    expect(before[0].quantity).toBe(1)
    expect(after[0].quantity).toBe(2)
  })

  it('stops at the stepper ceiling', () => {
    const lines = addProductToLines([line({ quantity: MAX_LINE_QUANTITY })], product())
    expect(lines[0].quantity).toBe(MAX_LINE_QUANTITY)
  })
})

describe('quantities and removal', () => {
  it('sets a quantity', () => {
    expect(setLineQuantity([line()], 'p_p1', 4)[0].quantity).toBe(4)
  })

  it('caps at the ceiling and floors fractions', () => {
    expect(setLineQuantity([line()], 'p_p1', 99_999)[0].quantity).toBe(MAX_LINE_QUANTITY)
    expect(setLineQuantity([line()], 'p_p1', 2.9)[0].quantity).toBe(2)
  })

  it('zero or less drops the line', () => {
    expect(setLineQuantity([line()], 'p_p1', 0)).toEqual([])
    expect(setLineQuantity([line()], 'p_p1', -3)).toEqual([])
    expect(setLineQuantity([line()], 'p_p1', NaN)).toEqual([])
  })

  it('leaves other lines alone', () => {
    const lines = [line({ key: 'a' }), line({ key: 'b' })]
    expect(setLineQuantity(lines, 'a', 5).map((l) => l.quantity)).toEqual([5, 1])
    expect(removeLine(lines, 'a').map((l) => l.key)).toEqual(['b'])
  })

  it('removing something that is not there changes nothing', () => {
    expect(removeLine([line()], 'nope')).toHaveLength(1)
  })
})

describe('totals', () => {
  it('multiplies quantity by unit price, and sums', () => {
    expect(lineTotalCents(line({ quantity: 3, unitAmountCents: 800 }))).toBe(2400)
    expect(cartTotalCents([
      line({ key: 'a', quantity: 3, unitAmountCents: 800 }),
      line({ key: 'b', quantity: 1, unitAmountCents: 2500 }),
    ])).toBe(4900)
  })

  it('an empty cart is zero, not NaN', () => {
    expect(cartTotalCents([])).toBe(0)
  })

  it('reports how many of a product are already in the cart', () => {
    const lines = addProductToLines(addProductToLines([], product()), product())
    expect(quantityInCart(lines, 'p1')).toBe(2)
    expect(quantityInCart(lines, 'other')).toBe(0)
  })
})

describe('typed amounts', () => {
  it('rounds dollars to cents rather than truncating', () => {
    expect(parseAmountToCents('12.345')).toBe(1235)
    expect(parseAmountToCents('8')).toBe(800)
    expect(parseAmountToCents('0.05')).toBe(5)
  })

  it('rejects empty, zero and junk', () => {
    expect(parseAmountToCents('')).toBeNull()
    expect(parseAmountToCents('0')).toBeNull()
    expect(parseAmountToCents('-4')).toBeNull()
    expect(parseAmountToCents('abc')).toBeNull()
  })
})
