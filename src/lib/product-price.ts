/**
 * Product pricing — and everything else a variant inherits — in one place.
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
 *
 * The variant's PHOTO and DESCRIPTION inherit by exactly the same rule, so
 * resolveVariantPresentation sits beside the pricing rather than in a file of
 * its own: "what does this variant fall back to?" is one question with one
 * answer, and splitting it across two modules is how the shop and the editor
 * end up disagreeing about what a blank field means.
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

// ─── What a variant LOOKS like ───────────────────────────────────────────────

/** The photo and the words. NULL/blank on either = inherit the product's. */
export type Presentation = {
  imageUrl?: string | null
  /** Tiptap HTML, as every description in this app is. */
  description?: string | null
}

export type ResolvedPresentation = {
  imageUrl: string | null
  /** Still raw HTML — sanitize at DISPLAY, via <RichText>. Never here. */
  description: string | null
  /** True when the value shown came off the product, not the variant. */
  inheritsImage: boolean
  inheritsDescription: boolean
}

/**
 * What ONE variant shows — the single place photo/description inheritance is
 * decided, mirroring resolveVariantPricing directly above.
 *
 * The default is INHERIT, and it has to be, because that is what every variant
 * that exists today does: three sizes of one harness share one photo and one
 * blurb, typed once on the product. A variant only speaks for itself when the
 * trainer gives it something to say — the Red one photographed in red, the
 * Medium carrying "fits 12–18kg" that would be wrong on the other two.
 *
 * BLANK COUNTS AS ABSENT. A rich-text editor emptied out leaves `<p></p>`, not
 * null, and an empty string is what a cleared file input hands back; treating
 * either as an override would blank the product's photo/blurb on the shop while
 * the trainer's screen showed nothing wrong. The API normalises an empty
 * document to NULL on save as well, so the two agree.
 *
 * The `inherits*` flags exist so the editor can SAY "using the product's photo"
 * instead of showing an empty box that reads as broken.
 */
export function resolveVariantPresentation(
  product: Presentation,
  variant: Presentation | null | undefined,
): ResolvedPresentation {
  const ownImage = variant?.imageUrl?.trim() ? variant.imageUrl! : null
  // Cheap emptiness test on purpose: this module is imported by client
  // components, and pulling sanitize-html in to ask "is this <p></p>?" would
  // put the sanitizer in every bundle that shows a price. The one document the
  // regex can't see through — `<p></p>` — is already turned into null by the
  // route that saves it.
  const ownDescription = stripsToNothing(variant?.description) ? null : variant!.description!

  return {
    imageUrl: ownImage ?? (product.imageUrl?.trim() ? product.imageUrl! : null),
    description: ownDescription ?? (stripsToNothing(product.description) ? null : product.description!),
    inheritsImage: ownImage == null,
    inheritsDescription: ownDescription == null,
  }
}

/** Empty, whitespace, or an editor's empty document — all mean "nothing here". */
function stripsToNothing(html: string | null | undefined): boolean {
  if (!html) return true
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''
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
