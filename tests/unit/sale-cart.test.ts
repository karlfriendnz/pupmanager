import { describe, it, expect } from 'vitest'

// The instant-sale cart, as arithmetic. The composer is a three-step wizard
// whose cart survives stepping back and forth, so every mutation is a pure
// function over a plain array — which is exactly what these lock down.
import {
  MAX_LINE_QUANTITY,
  PRODUCT_SEARCH_THRESHOLD,
  addProductToLines,
  canAddToCart,
  cartTotalCents,
  catalogueLines,
  filterProducts,
  hasOptions,
  lineTotalCents,
  matchesProductQuery,
  parseAmountToCents,
  productLineKey,
  quantityInCart,
  removeLine,
  saleUnitPriceCents,
  sellableProducts,
  sellableVariants,
  setLineQuantity,
  shelfInStock,
  shelfStockCount,
  shouldOfferProductSearch,
  type SaleLine,
  type SaleProduct,
  type SaleVariant,
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
  it('adds a new line at the sale price, carrying the Xero code and the product', () => {
    const lines = addProductToLines([], product({ priceCents: 4000, salePriceCents: 2500, xeroAccountCode: '200' }))
    expect(lines).toEqual([{
      key: productLineKey('p1'),
      description: 'Ball thrower',
      quantity: 1,
      unitAmountCents: 2500,
      xeroAccountCode: '200',
      // The whole point of the line: it names the thing sold, so the server can
      // take it off the shelf and list it on the product's own screen.
      productId: 'p1',
      variantId: null,
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

// ─── Options (variants) ──────────────────────────────────────────────────────
//
// A harness in S/M/L is three shelves, three prices and three things to hand
// over. The cart has to keep them apart or the till rings up the wrong money
// and the server takes the wrong size off the shelf.

const variant = (over: Partial<SaleVariant> = {}): SaleVariant => ({
  id: 'v1',
  name: 'Large',
  priceCents: null,
  salePriceCents: null,
  stockCount: null,
  active: true,
  ...over,
})

describe('options', () => {
  it('hides inactive options — they are off the shop', () => {
    const p = product({ variants: [variant({ id: 'a' }), variant({ id: 'b', active: false })] })
    expect(sellableVariants(p).map(v => v.id)).toEqual(['a'])
    expect(hasOptions(p)).toBe(true)
    expect(hasOptions(product())).toBe(false)
  })

  it('a product priced only on its options is still sellable', () => {
    const p = product({ priceCents: null, variants: [variant({ priceCents: 4500 })] })
    expect(sellableProducts([p])).toHaveLength(1)
  })

  it('a product whose every option is unpriced is not', () => {
    const p = product({ priceCents: null, variants: [variant({ priceCents: null })] })
    expect(sellableProducts([p])).toHaveLength(0)
  })

  // The one rule this must never re-derive: setting your own price opts you out
  // of the product's sale. product-price.ts owns it; the cart just asks.
  it('prices an option through product-price, sale and all', () => {
    const p = product({ priceCents: 4500, salePriceCents: 2900 })
    expect(saleUnitPriceCents(p, variant({ priceCents: null }))).toBe(2900)
    expect(saleUnitPriceCents(p, variant({ priceCents: 6000 }))).toBe(6000)
    expect(saleUnitPriceCents(p, null)).toBe(2900)
  })

  it('a Small and a Large are two lines, at two prices', () => {
    const p = product({ priceCents: 4500, variants: [variant({ id: 's', name: 'Small' }), variant({ id: 'l', name: 'Large', priceCents: 6000 })] })
    let lines = addProductToLines([], p, sellableVariants(p)[0])
    lines = addProductToLines(lines, p, sellableVariants(p)[1])

    expect(lines.map(l => l.key)).toEqual([productLineKey('p1', 's'), productLineKey('p1', 'l')])
    expect(lines.map(l => l.description)).toEqual(['Ball thrower · Small', 'Ball thrower · Large'])
    expect(lines.map(l => l.unitAmountCents)).toEqual([4500, 6000])
    expect(lines.map(l => l.variantId)).toEqual(['s', 'l'])
  })

  it('tapping the same option again stacks it, and only it', () => {
    const p = product({ variants: [variant({ id: 's' }), variant({ id: 'l' })] })
    let lines = addProductToLines([], p, variant({ id: 's' }))
    lines = addProductToLines(lines, p, variant({ id: 's' }))
    lines = addProductToLines(lines, p, variant({ id: 'l' }))

    expect(quantityInCart(lines, 'p1', 's')).toBe(2)
    expect(quantityInCart(lines, 'p1', 'l')).toBe(1)
    // Without a variant the question is about the product as a whole.
    expect(quantityInCart(lines, 'p1')).toBe(3)
  })
})

describe('what is left on the shelf', () => {
  it('reads the option’s count when there is one, the product’s when there is not', () => {
    const p = product({ stockCount: 9 })
    expect(shelfStockCount(p)).toBe(9)
    expect(shelfStockCount(p, variant({ stockCount: 2 }))).toBe(2)
  })

  // A service or a digital download never runs out, and must never read as
  // sold out — the same rule stock.ts applies server-side.
  it('an untracked shelf is always available', () => {
    expect(shelfInStock(product({ stockCount: null }))).toBe(true)
    expect(canAddToCart([], product({ stockCount: null }))).toBe(true)
    expect(shelfInStock(product({ stockCount: 0 }))).toBe(false)
  })

  it('stops adding once the cart holds everything on the shelf', () => {
    const p = product({ stockCount: 2 })
    let lines = addProductToLines([], p)
    expect(canAddToCart(lines, p)).toBe(true)
    lines = addProductToLines(lines, p)
    expect(canAddToCart(lines, p)).toBe(false)
  })

  it('counts each option against its own shelf', () => {
    const p = product({ variants: [variant({ id: 's', stockCount: 1 }), variant({ id: 'l', stockCount: 5 })] })
    const small = sellableVariants(p)[0]
    const large = sellableVariants(p)[1]
    const lines = addProductToLines([], p, small)

    expect(canAddToCart(lines, p, small)).toBe(false)
    expect(canAddToCart(lines, p, large)).toBe(true)
  })
})

describe('what goes on the wire', () => {
  it('keeps catalogue lines and drops one-off ones', () => {
    const p = product({ variants: [variant({ id: 'l' })] })
    const lines = [
      ...addProductToLines([], p, variant({ id: 'l' })),
      { key: 'c_1', description: 'Nail trim', quantity: 1, unitAmountCents: 1500 },
    ]

    expect(catalogueLines(lines)).toEqual([
      { productId: 'p1', variantId: 'l', quantity: 1, description: 'Ball thrower · Large' },
    ])
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
