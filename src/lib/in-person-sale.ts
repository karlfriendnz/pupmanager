import type { Prisma, PrismaClient } from '@/generated/prisma'
import { prisma } from '@/lib/prisma'
import { takeStock } from '@/lib/stock'

/**
 * The catalogue half of an in-person sale.
 *
 * The instant-sale composer used to hand the invoice a row of words — "Harness
 * · Large, 1, $45" — and stop there. That made a face-to-face sale the only way
 * to move a product without the app noticing: the product's own screen listed
 * card checkouts and pay-later requests and was blind to the counter, and a
 * trainer who sold six harnesses at a class still showed six on the shelf.
 *
 * So a till line now names the PRODUCT (and the VARIANT, when the trainer
 * picked a size), and this module turns that name into the two records the rest
 * of the app already reads:
 *
 *   - a unit off the shelf, through `takeStock` — the sole writer of
 *     `stockCount`, which keeps the ledger beside the balance so the number can
 *     always be explained;
 *   - a FULFILLED `ProductRequest`, which is exactly how the Stripe webhook
 *     records a paid product ("a paid product becomes a FULFILLED request the
 *     trainer hands over"). Over the counter it is already in their hands, so
 *     FULFILLED is the truth from the first second.
 *
 * The money stays where it was: the Invoice. Nothing here writes an amount, so
 * there is no second place for a price to be worked out.
 */

type Db = PrismaClient | Prisma.TransactionClient

/**
 * How a hand-over sold at the counter is marked, so the product screen can say
 * "Sold in person" rather than guessing at "Pay later".
 *
 * `ProductRequest` carries no column for where a sale came from, and adding one
 * is not worth a migration for a single word — the note is written and read in
 * this one module, so the two cannot drift.
 */
export const IN_PERSON_SALE_NOTE = 'Sold in person'

/** One catalogue line of a sale, as the composer sends it. */
export interface SaleItemInput {
  productId: string
  variantId?: string | null
  quantity: number
}

/** A line that has been checked against the trainer's own catalogue. */
export interface ResolvedSaleItem {
  productId: string
  variantId: string | null
  quantity: number
  /** "Harness · Large" — for the sentence the trainer is shown when we refuse. */
  label: string
}

export type SaleItemsResolution =
  | { ok: true; items: ResolvedSaleItem[] }
  | { ok: false; error: string }

/**
 * Check a sale's catalogue lines before any money is raised: every product is
 * this trainer's, every variant belongs to the product it claims, and there is
 * enough on the shelf for everything in the cart.
 *
 * WHY WE REFUSE AN EMPTY SHELF, rather than selling anyway and letting the
 * count go under. Every other path in this app refuses — the client's own buy
 * and request routes, and the trainer's "add a product to a client" — and a
 * till that quietly disagreed with the shop would be a second answer to "have
 * we got one?". The alternative is worse than it sounds: `stock.ts` clamps a
 * balance at zero on purpose ("a negative count on hand is never a true
 * statement about a shelf"), so an over-sell could only be recorded as a
 * movement of nothing at all — a ledger line that explains nothing, which is
 * the one thing the ledger exists to prevent. Refusing puts the discovery at
 * the till, with the customer still standing there, which is the cheapest
 * moment to find out the count is wrong; the trainer can correct the count on
 * the product (Stock → Received / Correction) or ring it up as a one-off line.
 *
 * UNTRACKED PRODUCTS ARE ALWAYS AVAILABLE. `stockCount: null` means "I never
 * run out of this" — a service, a digital download, a made-to-order item — so
 * it passes every check here, and `takeStock` writes no ledger line for it
 * later. A sale of a download can neither be refused nor drive a count
 * negative, because there is no count.
 */
export async function resolveSaleItems(
  trainerId: string,
  lines: SaleItemInput[],
): Promise<SaleItemsResolution> {
  const wanted = lines.filter(l => l.productId)
  if (wanted.length === 0) return { ok: true, items: [] }

  const products = await prisma.product.findMany({
    // Scoped by trainerId, not by id alone — an id from another business must
    // never be enough to sell (or de-stock) their product.
    where: { id: { in: [...new Set(wanted.map(l => l.productId))] }, trainerId },
    select: {
      id: true,
      name: true,
      stockCount: true,
      // Hidden variants included on purpose: `active` governs the client's
      // shop, and a trainer clearing the last of a discontinued size at the
      // counter is recording what happened.
      variants: { select: { id: true, name: true, stockCount: true } },
    },
  })
  const byId = new Map(products.map(p => [p.id, p]))

  const items: ResolvedSaleItem[] = []
  for (const line of wanted) {
    const product = byId.get(line.productId)
    if (!product) return { ok: false, error: 'One of those items isn’t in your catalogue any more.' }

    const variantId = line.variantId ?? null
    const variant = variantId ? product.variants.find(v => v.id === variantId) ?? null : null
    if (variantId && !variant) {
      return { ok: false, error: `That option isn’t one of ${product.name}’s any more.` }
    }
    if (!variantId && product.variants.length > 0) {
      return { ok: false, error: `Choose an option for ${product.name} first.` }
    }

    items.push({
      productId: product.id,
      variantId,
      quantity: line.quantity,
      label: variant ? `${product.name} · ${variant.name}` : product.name,
    })
  }

  // Shelf by shelf, not line by line: two lines of the same Large are three
  // units off ONE count, and checking them separately would let a cart of
  // two-plus-two clear a shelf holding three.
  const needed = new Map<string, { onHand: number | null; units: number; label: string }>()
  for (const item of items) {
    const product = byId.get(item.productId)!
    const variant = item.variantId ? product.variants.find(v => v.id === item.variantId) ?? null : null
    const key = `${item.productId}:${item.variantId ?? ''}`
    const seen = needed.get(key)
    if (seen) seen.units += item.quantity
    else {
      needed.set(key, {
        onHand: (variant ? variant.stockCount : product.stockCount) ?? null,
        units: item.quantity,
        label: item.label,
      })
    }
  }
  for (const shelf of needed.values()) {
    if (shelf.onHand === null) continue // untracked — never runs out
    if (shelf.units > shelf.onHand) {
      return {
        ok: false,
        error: shelf.onHand === 0
          ? `${shelf.label} is out of stock. Add stock on the product, or add it as a one-off line.`
          : `Only ${shelf.onHand} of ${shelf.label} left — the sale asks for ${shelf.units}.`,
      }
    }
  }

  return { ok: true, items }
}

/**
 * Move the stock and record who has what, once the sale itself exists.
 *
 * ONE UNIT AT A TIME, matching the Stripe webhook and `stock.ts`'s own rule
 * that "one product request is one unit off the shelf". A trainer selling three
 * of the same treat leaves three units off the count and three hand-overs on
 * the product's screen, which is what they can check against the shelf.
 *
 * `takeStock` returning false here means the shelf emptied between
 * `resolveSaleItems` and this call — a race only reachable with two tills open
 * on one catalogue. The sale has already been rung up, so we log it and carry
 * on rather than throwing: telling a trainer their sale failed after it didn't
 * is worse than a count they have to correct.
 */
export async function fulfilInPersonSale(
  db: Db,
  args: {
    trainerId: string
    clientId: string
    userId?: string | null
    items: ResolvedSaleItem[]
  },
): Promise<void> {
  for (const item of args.items) {
    for (let unit = 0; unit < Math.max(1, item.quantity); unit++) {
      const took = await takeStock(db, item.productId, {
        clientId: args.clientId,
        userId: args.userId ?? null,
        variantId: item.variantId,
        note: IN_PERSON_SALE_NOTE,
      })
      if (!took) {
        console.warn('[in-person-sale] shelf emptied mid-sale', item.productId, item.variantId)
      }
      await db.productRequest.create({
        data: {
          clientId: args.clientId,
          productId: item.productId,
          variantId: item.variantId,
          status: 'FULFILLED',
          fulfilledAt: new Date(),
          note: IN_PERSON_SALE_NOTE,
        },
      })
    }
  }
}
