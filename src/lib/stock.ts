import type { Prisma, PrismaClient, StockMovementReason } from '@/generated/prisma'

/**
 * Stock, kept deliberately small.
 *
 * `Product.stockCount` is NULL for anything a trainer never runs out of — a
 * service, a digital download, a made-to-order item. Only a number means
 * "count this". So the rule is: one product request is one unit off the shelf,
 * and an untracked product always says yes.
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
 */

type Db = PrismaClient | Prisma.TransactionClient

/** Who caused a movement. Both sides are optional — a Stripe webhook fulfilling
 *  an order has no signed-in user, and a delivery booked in has no client. */
export interface StockContext {
  clientId?: string | null
  userId?: string | null
  note?: string | null
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
      // NULL means "the product's only SKU". When variants land, this points at
      // the one that moved and today's rows stay true without a backfill.
      variantId: null,
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

/** The two facts every mutation here needs about the product. */
async function loadProduct(db: Db, productId: string) {
  return db.product.findUnique({
    where: { id: productId },
    select: { stockCount: true, trainerId: true },
  })
}

/**
 * Take one unit. Returns false ONLY when the product is tracked and there's
 * none left — the caller should then refuse the sale.
 *
 * The decrement is a conditional update rather than read-then-write, so two
 * people buying the last one at once can't both succeed.
 *
 * An untracked product writes NO movement. There is no shelf to describe, and
 * a history of "sold one, balance unknown" against something that cannot run
 * out is noise that would swamp the products that are genuinely counted.
 */
export async function takeStock(db: Db, productId: string, ctx?: StockContext): Promise<boolean> {
  const product = await loadProduct(db, productId)
  if (!product) return false
  if (product.stockCount === null) return true // not tracked — always available

  const { count } = await db.product.updateMany({
    where: { id: productId, stockCount: { gt: 0 } },
    data: { stockCount: { decrement: 1 } },
  })
  if (count !== 1) return false

  // Re-read rather than assuming `stockCount - 1`: the update raced by design,
  // and balanceAfter is only worth storing if it is the balance that actually
  // resulted.
  const after = await loadProduct(db, productId)
  await recordMovement(db, {
    productId,
    trainerId: product.trainerId,
    delta: -1,
    reason: 'SOLD',
    balanceAfter: after?.stockCount ?? null,
    ctx,
  })
  return true
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
  if (units <= 0) return (await loadProduct(db, productId))?.stockCount ?? null
  const before = await loadProduct(db, productId)
  if (!before) return null
  // Untracked: incrementing NULL leaves NULL, and there is no balance to
  // describe, so no ledger line either. Starting to count goes through
  // setStockCount, which records the opening balance.
  if (before.stockCount === null) return null

  const product = await db.product.update({
    where: { id: productId },
    data: { stockCount: { increment: units } },
    select: { stockCount: true },
  })
  await recordMovement(db, {
    productId,
    trainerId: before.trainerId,
    delta: units,
    reason: opts?.reason ?? 'RECEIVED',
    balanceAfter: product.stockCount,
    ctx: opts,
  })
  return product.stockCount
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
  const before = await loadProduct(db, productId)
  if (!before || before.stockCount === null) return null // untracked — nothing to adjust
  if (args.delta === 0) return before.stockCount

  const next = Math.max(0, before.stockCount + args.delta)
  await db.product.update({ where: { id: productId }, data: { stockCount: next } })
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
  args: { productId: string; trainerId: string; units: number; userId?: string | null },
): Promise<void> {
  await recordMovement(db, {
    productId: args.productId,
    trainerId: args.trainerId,
    delta: args.units,
    reason: 'CORRECTION',
    balanceAfter: args.units,
    ctx: { userId: args.userId ?? null, note: 'Opening count' },
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
  const before = await loadProduct(db, productId)
  if (!before) return null
  if (before.stockCount === next) return next

  await db.product.update({ where: { id: productId }, data: { stockCount: next } })
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
