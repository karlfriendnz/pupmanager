/**
 * The instant-sale cart, as pure functions.
 *
 * The composer (`src/components/shared/sale-composer.tsx`) is a three-step
 * wizard, and every step can be stepped back into — so the cart has to be
 * plain data the parent owns, not something a step component holds. Keeping
 * the rules here means the arithmetic is unit-testable without React, and the
 * "what can actually be sold" filter can't drift between the grid and the
 * total.
 *
 * Money is always in minor units (cents). Never format here — the app is
 * multi-currency and formatting belongs to `formatMoney`.
 */

import { effectivePriceCents } from './product-price'

/** One row in the cart. `key` is stable so the steppers can target it. */
export type SaleLine = {
  key: string
  description: string
  quantity: number
  unitAmountCents: number
  xeroAccountCode?: string | null
}

/** The shape of a product the composer can ring up. */
export type SaleProduct = {
  id: string
  name: string
  priceCents: number | null
  salePriceCents?: number | null
  imageUrl: string | null
  active: boolean
  xeroAccountCode?: string | null
}

/** Nobody sells a thousand of anything by tapping "+", so the stepper stops there. */
export const MAX_LINE_QUANTITY = 1000

/**
 * Above this many sellable products, scanning a grid stops being realistic and
 * the search field earns its space. Below it, the grid IS the search — an empty
 * box above six tiles is just chrome.
 */
export const PRODUCT_SEARCH_THRESHOLD = 8

/** Should the catalogue offer a search box for this many products? */
export function shouldOfferProductSearch(count: number): boolean {
  return count > PRODUCT_SEARCH_THRESHOLD
}

/** The cart key a catalogue product occupies, so re-tapping it stacks. */
export function productLineKey(productId: string): string {
  return `p_${productId}`
}

/**
 * Only priced, active products can be tapped in — an unpriced one ("contact
 * trainer") has no amount to ring up.
 *
 * A product on sale rings up at its SALE price, the same number the client
 * would pay in the shop, so an in-person sale can't quietly cost more.
 */
export function sellableProducts<T extends SaleProduct>(products: T[]): T[] {
  return products.filter((p) => {
    const cents = effectivePriceCents(p)
    return p.active && cents != null && cents > 0
  })
}

/** Case- and whitespace-insensitive name match. Empty query matches everything. */
export function matchesProductQuery(product: { name: string }, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return product.name.toLowerCase().includes(q)
}

/** The catalogue narrowed by what the trainer typed. */
export function filterProducts<T extends SaleProduct>(products: T[], query: string): T[] {
  const q = query.trim()
  if (!q) return products
  return products.filter((p) => matchesProductQuery(p, q))
}

/**
 * Tap a product in. Tapping one that's already in the cart bumps its quantity
 * rather than adding a second row — a trainer ringing up three of the same
 * treat taps it three times, and expects one line showing 3.
 */
export function addProductToLines<T extends SaleProduct>(lines: SaleLine[], product: T): SaleLine[] {
  const key = productLineKey(product.id)
  if (lines.some((l) => l.key === key)) {
    return lines.map((l) =>
      l.key === key ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + 1) } : l,
    )
  }
  return [
    ...lines,
    {
      key,
      description: product.name,
      quantity: 1,
      unitAmountCents: effectivePriceCents(product) ?? 0,
      xeroAccountCode: product.xeroAccountCode ?? null,
    },
  ]
}

/**
 * Set a line's quantity. Zero or less drops the line — but the UI no longer
 * relies on that: "−" stops at 1 and removal is its own explicit button, so a
 * trainer can't lose a line by over-tapping the minus.
 */
export function setLineQuantity(lines: SaleLine[], key: string, next: number): SaleLine[] {
  if (!Number.isFinite(next) || next <= 0) return removeLine(lines, key)
  return lines.map((l) =>
    l.key === key ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, Math.floor(next)) } : l,
  )
}

/** Drop a line entirely. */
export function removeLine(lines: SaleLine[], key: string): SaleLine[] {
  return lines.filter((l) => l.key !== key)
}

/** What one line comes to. */
export function lineTotalCents(line: SaleLine): number {
  return line.quantity * line.unitAmountCents
}

/** What the whole sale comes to. */
export function cartTotalCents(lines: SaleLine[]): number {
  return lines.reduce((sum, l) => sum + lineTotalCents(l), 0)
}

/** How many of this product are already in the cart. 0 when it isn't. */
export function quantityInCart(lines: SaleLine[], productId: string): number {
  return lines.find((l) => l.key === productLineKey(productId))?.quantity ?? 0
}

/**
 * Dollars typed into a field → cents on the wire. Rounds rather than truncates
 * so 12.345 doesn't quietly become 12.34. Returns null when it isn't a usable
 * amount, so callers have one thing to check.
 */
export function parseAmountToCents(input: string): number | null {
  const cents = Math.round(parseFloat(input || '0') * 100)
  if (!Number.isFinite(cents) || cents <= 0) return null
  return cents
}
