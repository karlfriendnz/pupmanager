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
 *
 * VARIANTS inherit both prices from the product when theirs are NULL, which is
 * resolved at the bottom of this file (resolveVariantPricing). It lives here,
 * once, because a screen that re-derives "the variant's price, or the
 * product's" is a screen that will eventually derive it differently.
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

// ─── Variants ────────────────────────────────────────────────────────────────

/** The two prices a variant may override. NULL on either = inherit. */
export type VariantPricing = {
  priceCents?: number | null
  salePriceCents?: number | null
}

/**
 * What ONE variant costs — the single place price inheritance is decided.
 *
 * A variant with `priceCents = null` costs what the product costs. That is the
 * common case by a mile: five sizes of the same harness at one price, typed
 * once. The two fields inherit INDEPENDENTLY, so a trainer can put just the
 * Large on sale, or charge more for the Large without touching the sale.
 *
 * The one subtlety, and the reason this is a function rather than two `??`s at
 * each call site: SETTING YOUR OWN PRICE OPTS YOU OUT OF THE PRODUCT'S SALE.
 * A product at $45 marked down to $29, with a Large priced at $60, would
 * otherwise inherit the flat $29 and sell the Large for less than the Small —
 * a discount the trainer never agreed to, off a base price the sale was never
 * set against. A variant that names its own price names its own sale too, or
 * has none.
 */
export function resolveVariantPricing(
  product: ProductPricing,
  variant: VariantPricing | null | undefined,
): ProductPricing {
  if (!variant) return { priceCents: product.priceCents ?? null, salePriceCents: product.salePriceCents ?? null }

  const ownPrice = variant.priceCents != null
  const priceCents = variant.priceCents ?? product.priceCents ?? null
  const salePriceCents = variant.salePriceCents ?? (ownPrice ? null : product.salePriceCents ?? null)

  // Belt and braces: a sale that doesn't undercut the price beside it isn't a
  // sale, it's a bigger number wearing a "was" label.
  if (salePriceCents != null && priceCents != null && salePriceCents >= priceCents) {
    return { priceCents, salePriceCents: null }
  }
  return { priceCents, salePriceCents }
}

/** What this variant costs right now, with inheritance applied. */
export function variantPriceCents(
  product: ProductPricing,
  variant: VariantPricing | null | undefined,
): number | null {
  return effectivePriceCents(resolveVariantPricing(product, variant))
}

/**
 * What a product costs when it has variants: the cheapest and dearest of the
 * ones a client can actually pick.
 *
 * `count` is 0 for a product with no variants, and every caller treats that as
 * "carry on exactly as before" — the products table shows its one price, the
 * shop shows its one price. Only a count above 0 makes a screen say "3
 * options" or "from $X", which is the whole point: a varianted product must
 * never pretend to have a single price it doesn't have.
 */
export function productPriceSummary(
  product: ProductPricing,
  variants: (VariantPricing & { active?: boolean })[],
): { count: number; from: number | null; to: number | null; varies: boolean } {
  const sellable = variants.filter(v => v.active !== false)
  if (sellable.length === 0) {
    return { count: 0, from: effectivePriceCents(product), to: effectivePriceCents(product), varies: false }
  }
  const prices = sellable
    .map(v => variantPriceCents(product, v))
    .filter((n): n is number => n != null)
  if (prices.length === 0) return { count: sellable.length, from: null, to: null, varies: false }
  const from = Math.min(...prices)
  const to = Math.max(...prices)
  // "varies" also covers a variant with no price at all sitting beside priced
  // ones — "from $20" is honest there, "$20" would not be.
  return { count: sellable.length, from, to, varies: from !== to || prices.length !== sellable.length }
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
