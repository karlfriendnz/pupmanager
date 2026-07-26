import type { Prisma, PrismaClient } from '@/generated/prisma'

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
 */

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Take one unit. Returns false ONLY when the product is tracked and there's
 * none left — the caller should then refuse the sale.
 *
 * The decrement is a conditional update rather than read-then-write, so two
 * people buying the last one at once can't both succeed.
 */
export async function takeStock(db: Db, productId: string): Promise<boolean> {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { stockCount: true },
  })
  if (!product) return false
  if (product.stockCount === null) return true // not tracked — always available

  const { count } = await db.product.updateMany({
    where: { id: productId, stockCount: { gt: 0 } },
    data: { stockCount: { decrement: 1 } },
  })
  return count === 1
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

/** Put units back on the shelf (a delivery arrived, or a sale fell through). */
export async function addStock(db: Db, productId: string, units: number): Promise<number | null> {
  const product = await db.product.update({
    where: { id: productId },
    data: { stockCount: { increment: units } },
    select: { stockCount: true },
  })
  return product.stockCount
}
