import { prisma } from '@/lib/prisma'
import { addStock } from '@/lib/stock'

/**
 * Undo a shop order.
 *
 * Ordering a product does three things: it takes a unit off the shelf, creates
 * the ProductRequest, and raises a receivable. Cancelling used to undo exactly
 * one of them — the request row — which left the client owing for something
 * they cancelled and will never receive, and the trainer's stock short by one
 * with no movement explaining it (audit C-3).
 *
 * Both cancel paths come through here: the client's "Requested · Tap to cancel"
 * and the trainer dismissing the order from the client's profile.
 *
 * Money that has already moved is left alone. A PARTIAL or PAID invoice is a
 * refund decision, and that belongs to the trainer, not to a tap.
 */
export async function releaseCancelledRequest(row: {
  trainerId: string
  clientId: string
  productId: string
  variantId: string | null
}): Promise<{ stockReturned: boolean; invoiceCancelled: boolean }> {
  // Back on the shelf. Untracked stock (stockCount null) returns null and
  // writes no ledger line, which is right — there's no balance to describe.
  const balance = await addStock(prisma, row.productId, 1, {
    clientId: row.clientId,
    variantId: row.variantId,
    reason: 'RETURNED',
    note: 'Order cancelled',
  })

  // The receivable for THIS thing: a varianted product invoices per variant,
  // so the Small and the Large are two sources and two invoices.
  const invoice = await prisma.invoice.findFirst({
    where: {
      trainerId: row.trainerId,
      clientId: row.clientId,
      sourceType: 'PRODUCT',
      sourceId: row.variantId ?? row.productId,
      status: 'UNPAID',
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (invoice) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } })
  }

  return { stockReturned: balance !== null, invoiceCancelled: !!invoice }
}
