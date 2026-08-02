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

import { effectivePriceCents, variantPriceCents } from './product-price'
import { inStock } from './stock'

/**
 * One row in the cart. `key` is stable so the steppers can target it.
 *
 * `productId`/`variantId` are what turn a till receipt back into a SALE: a line
 * that only carries its description is a sentence, and a sentence cannot be
 * counted off a shelf or listed on the product's own screen. They are null for
 * a one-off "Something else" line, which genuinely has no catalogue behind it.
 */
export type SaleLine = {
  key: string
  description: string
  quantity: number
  unitAmountCents: number
  xeroAccountCode?: string | null
  productId?: string | null
  variantId?: string | null
}

/** One option under a product — a size, a colour. NULL prices inherit. */
export type SaleVariant = {
  id: string
  name: string
  priceCents?: number | null
  salePriceCents?: number | null
  /** NULL = not counted, exactly as on the product. */
  stockCount?: number | null
  active?: boolean
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
  /** NULL = never runs out (a service, a digital download). */
  stockCount?: number | null
  variants?: SaleVariant[]
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

/**
 * The cart key a catalogue product occupies, so re-tapping it stacks.
 *
 * A variant gets its OWN key. A Small and a Large are two shelves (see
 * stock.ts), two prices and two things to hand over, so stacking them onto one
 * line would ring up the wrong money and take the wrong size off the shelf.
 */
export function productLineKey(productId: string, variantId?: string | null): string {
  return variantId ? `p_${productId}_${variantId}` : `p_${productId}`
}

/** The options a client can actually be sold. A hidden variant is off the shop. */
export function sellableVariants(product: SaleProduct): SaleVariant[] {
  return (product.variants ?? []).filter((v) => v.active !== false)
}

/** Does this product make the trainer pick an option before it can be rung up? */
export function hasOptions(product: SaleProduct): boolean {
  return sellableVariants(product).length > 0
}

/** What one tap rings up — the variant's price when one was picked. */
export function saleUnitPriceCents(product: SaleProduct, variant?: SaleVariant | null): number | null {
  return variant ? variantPriceCents(product, variant) : effectivePriceCents(product)
}

/**
 * Only priced, active products can be tapped in — an unpriced one ("contact
 * trainer") has no amount to ring up.
 *
 * A product on sale rings up at its SALE price, the same number the client
 * would pay in the shop, so an in-person sale can't quietly cost more.
 *
 * With variants the price lives on the OPTIONS, so the product earns its tile
 * as soon as one option has a usable price — a harness priced only per size is
 * perfectly sellable, and dropping it because the product row says NULL is how
 * a trainer ends up typing "Harness" as a free-text line.
 */
export function sellableProducts<T extends SaleProduct>(products: T[]): T[] {
  return products.filter((p) => {
    if (!p.active) return false
    const options = sellableVariants(p)
    if (options.length > 0) {
      return options.some((v) => {
        const cents = variantPriceCents(p, v)
        return cents != null && cents > 0
      })
    }
    const cents = effectivePriceCents(p)
    return cents != null && cents > 0
  })
}

/**
 * Units on hand for the shelf a tap would come off — the variant's when one is
 * picked, the product's when there are none. NULL means "not counted", and a
 * digital download or a service is NULL forever.
 */
export function shelfStockCount(product: SaleProduct, variant?: SaleVariant | null): number | null {
  return (variant ? variant.stockCount : product.stockCount) ?? null
}

/**
 * Can another one of these go in the cart?
 *
 * The cart is checked as well as the shelf: tapping a tile six times when four
 * are on hand is the same over-sell as tapping it once when none are, and the
 * trainer should find out at the sixth tap rather than at the till.
 */
export function canAddToCart(
  lines: SaleLine[],
  product: SaleProduct,
  variant?: SaleVariant | null,
): boolean {
  const onHand = shelfStockCount(product, variant)
  if (onHand === null) return true // not counted — never runs out
  return quantityInCart(lines, product.id, variant?.id ?? null) < onHand
}

/** Is there anything at all left on this shelf? */
export function shelfInStock(product: SaleProduct, variant?: SaleVariant | null): boolean {
  return inStock(shelfStockCount(product, variant))
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
 *
 * The price is never re-derived here: `saleUnitPriceCents` defers to
 * product-price.ts, which is the one place a variant's inheritance (and its
 * opt-out from the product's sale) is decided. This repo has mis-priced a real
 * customer twice by having two code paths work the same number out separately.
 */
export function addProductToLines<T extends SaleProduct>(
  lines: SaleLine[],
  product: T,
  variant?: SaleVariant | null,
): SaleLine[] {
  const key = productLineKey(product.id, variant?.id ?? null)
  if (lines.some((l) => l.key === key)) {
    return lines.map((l) =>
      l.key === key ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + 1) } : l,
    )
  }
  return [
    ...lines,
    {
      key,
      // "Harness · Large" — the option is part of what was sold, so it belongs
      // on the invoice line the client reads, not just in our own data.
      description: variant ? `${product.name} · ${variant.name}` : product.name,
      quantity: 1,
      unitAmountCents: saleUnitPriceCents(product, variant) ?? 0,
      xeroAccountCode: product.xeroAccountCode ?? null,
      productId: product.id,
      variantId: variant?.id ?? null,
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

/**
 * How many of this product are already in the cart. 0 when it isn't.
 *
 * Pass a `variantId` for one shelf's worth; leave it off for the product as a
 * whole, which is what the tile shows — "2 in this sale" across a Small and a
 * Large is the answer a trainer glancing at the grid wants.
 */
export function quantityInCart(
  lines: SaleLine[],
  productId: string,
  variantId?: string | null,
): number {
  if (variantId !== undefined) {
    return lines.find((l) => l.key === productLineKey(productId, variantId))?.quantity ?? 0
  }
  return lines
    .filter((l) => l.productId === productId)
    .reduce((n, l) => n + l.quantity, 0)
}

/**
 * The catalogue lines of a sale, as the wire carries them — the trainer's own
 * one-off lines are dropped, because there is no product behind them to count
 * off a shelf or to list on a product's screen.
 */
export function catalogueLines(
  lines: SaleLine[],
): { productId: string; variantId: string | null; quantity: number; description: string }[] {
  return lines
    .filter((l): l is SaleLine & { productId: string } => !!l.productId)
    .map((l) => ({
      productId: l.productId,
      variantId: l.variantId ?? null,
      quantity: l.quantity,
      description: l.description,
    }))
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
