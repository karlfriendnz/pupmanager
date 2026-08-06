import type { Prisma, PrismaClient, StockMovementReason } from '@/generated/prisma'

/**
 * Stock, kept deliberately small.
 *
 * `Product.stockCount` is NULL for anything a trainer never runs out of — a
 * service, a digital download, a made-to-order item. Only a number means
 * "count this". So the rule is: a product request takes ITS QUANTITY off the
 * shelf, and an untracked product always says yes.
 *
 * Every path that hands a product to a client goes through `takeStock` first:
 * the client's own purchase (card or pay-later), a trainer recording a sale,
 * a Stripe payment settling, and a membership granting its included products.
 *
 * BALANCE + LEDGER. `stockCount` stays the running balance — the products
 * table, the client shop, `inStock()` and `stockLabel()` all read it, and a
 * SUM() per product on every render is not worth paying for. Every change to
 * it ALSO writes a StockMovement, in the same transaction, so "twelve on the
 * shelf" can be explained. This file is the only place that writes either, so
 * the two cannot drift: change the balance here or not at all.
 *
 * VARIANTS. A harness in S/M/L is three shelves, not one, so when a product
 * has variants the counts live on the VARIANT rows and `Product.stockCount` is
 * ignored (see productInStock/totalStock below). Every writer here takes an
 * optional `variantId` naming which shelf moved; without one they target the
 * product row exactly as they always have, which is why a product with no
 * variants behaves identically and why existing movements need no backfill.
 */

type Db = PrismaClient | Prisma.TransactionClient

/** Who caused a movement. Both sides are optional — a Stripe webhook fulfilling
 *  an order has no signed-in user, and a delivery booked in has no client. */
export interface StockContext {
  clientId?: string | null
  userId?: string | null
  note?: string | null
  /**
   * WHICH shelf. NULL/absent = the product's own count, which is both the old
   * behaviour and the right one for a product with no variants. A variant id
   * that doesn't belong to this product is refused rather than silently
   * moving another product's stock.
   */
  variantId?: string | null
}

/**
 * Write one ledger line. Private on purpose: a movement without a matching
 * change to `stockCount` is exactly the drift the ledger exists to expose.
 *
 * `trainerId` is read off the product rather than passed in — it is the tenant
 * scope for every ledger query, and a caller passing the wrong one would build
 * a history that leaks across businesses.
 */
async function recordMovement(
  db: Db,
  args: {
    productId: string
    trainerId: string
    delta: number
    reason: StockMovementReason
    balanceAfter: number | null
    ctx?: StockContext
  },
) {
  await db.stockMovement.create({
    data: {
      productId: args.productId,
      // NULL means "the product's only SKU" — every row written before variants
      // existed says exactly that, which is why none of them needed changing.
      variantId: args.ctx?.variantId ?? null,
      trainerId: args.trainerId,
      delta: args.delta,
      reason: args.reason,
      note: args.ctx?.note ?? null,
      balanceAfter: args.balanceAfter,
      clientId: args.ctx?.clientId ?? null,
      userId: args.ctx?.userId ?? null,
    },
  })
}

/**
 * The shelf a write is about: the variant's row when one is named, the
 * product's when it isn't.
 *
 * The variant read is scoped by productId as well as its own id, so a caller
 * passing a variant of some OTHER product moves nothing at all rather than
 * quietly decrementing a stranger's stock.
 */
async function loadShelf(db: Db, productId: string, variantId?: string | null) {
  if (variantId) {
    const variant = await db.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { stockCount: true, trainerId: true },
    })
    return variant
  }
  return db.product.findUnique({
    where: { id: productId },
    select: { stockCount: true, trainerId: true },
  })
}

/** Write the new balance to whichever row `loadShelf` was reading. */
async function writeBalance(
  db: Db,
  productId: string,
  variantId: string | null | undefined,
  stockCount: number | { increment: number } | null,
): Promise<number | null> {
  if (variantId) {
    const v = await db.productVariant.update({
      where: { id: variantId },
      data: { stockCount },
      select: { stockCount: true },
    })
    return v.stockCount
  }
  const p = await db.product.update({
    where: { id: productId },
    data: { stockCount },
    select: { stockCount: true },
  })
  return p.stockCount
}

/**
 * Take `units` off the shelf, ALL OR NOTHING. Returns false ONLY when the
 * product is tracked and there aren't that many left — the caller should then
 * refuse the sale.
 *
 * `units` defaults to 1, which is every caller that predates ordering more than
 * one of a thing, and is why none of them needed changing.
 *
 * ALL OR NOTHING is the point. A client asking for three and being handed two,
 * with a receivable for three, is a worse outcome than a refusal they can act
 * on — so the conditional update below requires the whole quantity to be there
 * (`stockCount: { gte: units }`) rather than taking what it can. The refusal
 * message names how many are actually left; the callers do that.
 *
 * The decrement is a conditional update rather than read-then-write, so two
 * people buying the last one at once can't both succeed.
 *
 * ONE movement for the whole take, not one per unit: "sold 3, balance 9" is the
 * true statement about what happened, and three lines of -1 would imply three
 * separate sales that a trainer reading the ledger would have to reassemble.
 *
 * An untracked product writes NO movement. There is no shelf to describe, and
 * a history of "sold one, balance unknown" against something that cannot run
 * out is noise that would swamp the products that are genuinely counted.
 */
export async function takeStock(
  db: Db,
  productId: string,
  ctx?: StockContext,
  units = 1,
): Promise<boolean> {
  // A non-positive take is a caller bug, not a shelf movement. Refusing to
  // write a zero/negative "sale" keeps the ledger honest — and a fractional
  // quantity slipping in from a JSON body must never reach the database.
  const take = Math.floor(units)
  if (!Number.isFinite(take) || take < 1) return false

  const variantId = ctx?.variantId ?? null
  const shelf = await loadShelf(db, productId, variantId)
  if (!shelf) return false
  if (shelf.stockCount === null) return true // not tracked — always available

  // The conditional update targets the variant row when one was named, so two
  // people buying the last Large can't both succeed — and buying a Large never
  // touches the Small's count.
  const { count } = variantId
    ? await db.productVariant.updateMany({
        where: { id: variantId, productId, stockCount: { gte: take } },
        data: { stockCount: { decrement: take } },
      })
    : await db.product.updateMany({
        where: { id: productId, stockCount: { gte: take } },
        data: { stockCount: { decrement: take } },
      })
  if (count !== 1) return false

  // Re-read rather than assuming `stockCount - take`: the update raced by
  // design, and balanceAfter is only worth storing if it is the balance that
  // actually resulted.
  const after = await loadShelf(db, productId, variantId)
  await recordMovement(db, {
    productId,
    trainerId: shelf.trainerId,
    delta: -take,
    reason: 'SOLD',
    balanceAfter: after?.stockCount ?? null,
    ctx,
  })
  return true
}

/**
 * Put `units` back on the shelf because an order was undone — the named
 * counterpart of `takeStock`, so a cancel path reads as the mirror of the order
 * path instead of as a call to the delivery-booking-in helper.
 *
 * Thin on purpose: it is `addStock` with the reason pinned to RETURNED. The
 * reason is the whole difference between "a delivery arrived" and "a sale fell
 * through", and leaving it to each caller is how a cancel ends up filed as a
 * receipt.
 */
export async function returnStock(
  db: Db,
  productId: string,
  units: number,
  ctx?: StockContext,
): Promise<number | null> {
  return addStock(db, productId, Math.max(0, Math.floor(units)), { ...ctx, reason: 'RETURNED' })
}

/** Is this product available to buy right now? (Read-only — no reservation.) */
export function inStock(stockCount: number | null | undefined): boolean {
  return stockCount === null || stockCount === undefined || stockCount > 0
}

/**
 * What a client should see next to the item. Nothing at all for untracked
 * products — a count is only worth showing when it's real, and "In stock" on
 * something that can't run out is noise.
 */
export function stockLabel(stockCount: number | null | undefined): string | null {
  if (stockCount === null || stockCount === undefined) return null
  if (stockCount <= 0) return 'Out of stock'
  if (stockCount <= 5) return `Only ${stockCount} left`
  return `${stockCount} in stock`
}

/** The two facts a shelf-level read needs about a variant. */
export interface VariantStock {
  stockCount: number | null
  active?: boolean
}

/**
 * Can a client buy this product at all?
 *
 * With variants, the answer is about the variants: a harness is only sold out
 * once EVERY size is. With no variants it is `inStock(product.stockCount)`,
 * unchanged — which is what keeps every existing product behaving exactly as
 * it does today.
 *
 * Hidden variants don't count. An inactive one is off the shop, so it can't
 * hold a sold-out product open.
 */
export function productInStock(
  product: { stockCount: number | null },
  variants: VariantStock[] = [],
): boolean {
  const sellable = variants.filter(v => v.active !== false)
  if (sellable.length === 0) return inStock(product.stockCount)
  return sellable.some(v => inStock(v.stockCount))
}

/**
 * Units on hand for a product as a whole — the number in the trainer's Stock
 * column. Variants make it a SUM; without them it is the product's own count.
 *
 * NULL still means "not counted". A varianted product whose sizes are all
 * untracked has no count to show, exactly as an untracked plain product
 * doesn't — and a mix counts only the ones that are actually being counted,
 * because "3" is a truer answer than a 0 standing in for "who knows".
 */
export function totalStock(
  product: { stockCount: number | null },
  variants: VariantStock[] = [],
): number | null {
  const sellable = variants.filter(v => v.active !== false)
  if (sellable.length === 0) return product.stockCount
  const tracked = sellable.filter(v => v.stockCount !== null)
  if (tracked.length === 0) return null
  return tracked.reduce((sum, v) => sum + (v.stockCount ?? 0), 0)
}

/**
 * Put units back on the shelf (a delivery arrived, or a sale fell through).
 * Returns the new balance, or null when the product isn't tracked.
 */
export async function addStock(
  db: Db,
  productId: string,
  units: number,
  opts?: StockContext & { reason?: Extract<StockMovementReason, 'RECEIVED' | 'RETURNED'> },
): Promise<number | null> {
  const variantId = opts?.variantId ?? null
  if (units <= 0) return (await loadShelf(db, productId, variantId))?.stockCount ?? null
  const before = await loadShelf(db, productId, variantId)
  if (!before) return null
  // Untracked: incrementing NULL leaves NULL, and there is no balance to
  // describe, so no ledger line either. Starting to count goes through
  // setStockCount, which records the opening balance.
  if (before.stockCount === null) return null

  const balanceAfter = await writeBalance(db, productId, variantId, { increment: units })
  await recordMovement(db, {
    productId,
    trainerId: before.trainerId,
    delta: units,
    reason: opts?.reason ?? 'RECEIVED',
    balanceAfter,
    ctx: opts,
  })
  return balanceAfter
}

/**
 * A signed adjustment with a stated reason — a breakage, a lost item, a
 * hand-counted correction. Separate from addStock because the reason is the
 * point: "12 became 9" is useless a month later, "3 damaged" is not.
 *
 * The balance is clamped at zero. A negative count on hand is never a true
 * statement about a shelf, and the ledger keeps the delta that was asked for
 * so an over-large write-off is still visible.
 */
export async function adjustStock(
  db: Db,
  productId: string,
  args: StockContext & {
    delta: number
    reason: Extract<StockMovementReason, 'CORRECTION' | 'DAMAGED' | 'LOST' | 'SOLD' | 'RETURNED' | 'RECEIVED'>
  },
): Promise<number | null> {
  const before = await loadShelf(db, productId, args.variantId)
  if (!before || before.stockCount === null) return null // untracked — nothing to adjust
  if (args.delta === 0) return before.stockCount

  const next = Math.max(0, before.stockCount + args.delta)
  await writeBalance(db, productId, args.variantId, next)
  await recordMovement(db, {
    productId,
    trainerId: before.trainerId,
    delta: next - before.stockCount,
    reason: args.reason,
    balanceAfter: next,
    ctx: args,
  })
  return next
}

/**
 * The first line of a brand-new product's ledger.
 *
 * `setStockCount` cannot do this job: the product is created with its count
 * already on it, so there is no before-and-after for it to notice. Without a
 * line here a product born with 12 on hand sums to 0 against a shelf holding
 * twelve, from day one.
 */
export async function recordOpeningBalance(
  db: Db,
  args: {
    productId: string
    trainerId: string
    units: number
    userId?: string | null
    /** Set when the new shelf is a VARIANT — a size added to an existing product. */
    variantId?: string | null
  },
): Promise<void> {
  await recordMovement(db, {
    productId: args.productId,
    trainerId: args.trainerId,
    delta: args.units,
    reason: 'CORRECTION',
    balanceAfter: args.units,
    ctx: { userId: args.userId ?? null, note: 'Opening count', variantId: args.variantId ?? null },
  })
}

/**
 * Set the count to a number the trainer has just counted, or start counting a
 * product that was never tracked.
 *
 * The second case is why this exists at all: a trainer who types 12 into a
 * product that had no count has not "received 12", they have declared an
 * OPENING BALANCE, and without a line for it the ledger would sum to zero
 * against a shelf holding twelve — the exact drift the reconciliation test
 * looks for. Turning tracking OFF (next = null) writes no line: there is no
 * longer a balance for one to be about.
 */
export async function setStockCount(
  db: Db,
  productId: string,
  next: number | null,
  ctx?: StockContext,
): Promise<number | null> {
  const before = await loadShelf(db, productId, ctx?.variantId)
  if (!before) return null
  if (before.stockCount === next) return next

  await writeBalance(db, productId, ctx?.variantId, next)
  if (next === null) return null

  await recordMovement(db, {
    productId,
    trainerId: before.trainerId,
    delta: next - (before.stockCount ?? 0),
    reason: 'CORRECTION',
    balanceAfter: next,
    ctx: {
      ...ctx,
      note: ctx?.note ?? (before.stockCount === null ? 'Started counting this product' : null),
    },
  })
  return next
}
