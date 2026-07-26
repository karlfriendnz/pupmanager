/**
 * Product pricing, in one place.
 *
 * A product carries its normal `priceCents` plus an optional `salePriceCents`.
 * The sale price is not a display decoration — it is the price actually
 * charged, so every path that takes money for a product resolves it through
 * `effectivePriceCents` rather than reading `priceCents` directly. The normal
 * price stays put so the shop can strike it through and show the saving.
 *
 * Mirrors `Package.specialPriceCents`, which works the same way.
 */

export type ProductPricing = {
  priceCents: number | null | undefined
  salePriceCents?: number | null | undefined
}

/** What this product costs right now. Null = unpriced ("Contact trainer"). */
export function effectivePriceCents(p: ProductPricing): number | null {
  if (typeof p.salePriceCents === 'number') return p.salePriceCents
  return p.priceCents ?? null
}

/**
 * Is a saving being advertised? Only when there's a real reduction to show —
 * a sale price with no normal price above it isn't a sale, it's just the price.
 */
export function isOnSale(p: ProductPricing): boolean {
  return (
    typeof p.salePriceCents === 'number' &&
    typeof p.priceCents === 'number' &&
    p.salePriceCents < p.priceCents
  )
}

/** How much is knocked off, in cents. 0 when not on sale. */
export function savingCents(p: ProductPricing): number {
  if (!isOnSale(p)) return 0
  return (p.priceCents as number) - (p.salePriceCents as number)
}

/** Whole-percent discount, for a "20% off" tag. 0 when not on sale. */
export function savingPercent(p: ProductPricing): number {
  if (!isOnSale(p)) return 0
  return Math.round((savingCents(p) / (p.priceCents as number)) * 100)
}

/**
 * The one rule for a sale price, shared by the create and patch routes and by
 * the editor form so the trainer sees the same sentence the server would send.
 * Returns an error message, or null when the pair is fine.
 */
export function validateSalePrice(
  priceCents: number | null | undefined,
  salePriceCents: number | null | undefined
): string | null {
  if (salePriceCents == null) return null // clearing it always restores normal pricing
  if (salePriceCents < 0) return 'Sale price can’t be negative'
  if (priceCents == null) {
    return 'Set a normal price before putting this on sale'
  }
  if (salePriceCents >= priceCents) {
    return 'Sale price must be less than the normal price'
  }
  return null
}
