import { prisma } from '@/lib/prisma'
import { returnStock, takeStock } from '@/lib/stock'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { normaliseQuantity, shortStockMessage } from '@/lib/product-quantity'

/**
 * A shop order, and everything undoing one has to undo.
 *
 * ORDERING A PRODUCT DOES THREE THINGS: it takes units off the shelf, it
 * creates (or grows) the ProductRequest, and it raises a receivable. All three
 * live here, in one function, because they had drifted apart into three routes
 * that each did a slightly different subset — the trainer's add, the client's
 * request, and the client's book-now-pay-later buy. Cancelling used to undo
 * exactly one of them (audit C-3), and the fix only landed on the cancel side;
 * this is the other half of it.
 *
 * QUANTITY runs through all three. A request for three takes three off the
 * shelf and bills three × the price. The counts are the whole point: whatever
 * ordering did, cancelling has to do exactly as many times.
 */

/** The product facts an order needs, already resolved and ownership-checked. */
export interface OrderableProduct {
  id: string
  name: string
  /** NULL = not counted; the product can never run out. */
  stockCount: number | null
  /** The variant the client picked, when the product has options. */
  variant: { id: string; name: string; stockCount: number | null } | null
}

export interface PlaceOrderInput {
  trainerId: string
  clientId: string
  product: OrderableProduct
  /** How many. Already bounds-checked by the route's schema; clamped again here. */
  quantity?: number
  /** The client's own note ("for Bella, size L"). Only set on a NEW row. */
  note?: string | null
  /** What the stock ledger line should say happened. */
  stockNote: string
  /** Who did it, for the ledger. Null for a client acting on their own behalf. */
  userId?: string | null
}

export type PlaceOrderResult =
  | {
      ok: true
      /** The row as it now stands. */
      request: { id: string; quantity: number }
      /** False when an existing PENDING order grew instead. */
      created: boolean
      /** How many units this call added — what a cancel of THIS call would undo. */
      added: number
    }
  | {
      ok: false
      /** HTTP status the route should answer with. */
      status: 409
      error: string
    }

/**
 * Place (or grow) a PENDING order for a product.
 *
 * ADDING THE SAME THING TWICE INCREASES THE QUANTITY. It used to return the
 * existing row and do nothing at all — no stock moved, no money changed, and
 * the second tap looked exactly like the first — which is what Karl saw as "the
 * qty option is not working". Idempotency was the right instinct (a
 * double-tapped button must not order two harnesses) but it was applied to the
 * wrong thing: what must not happen twice is ONE tap's effect, not two taps.
 *
 * CANCELLED ROWS ARE NOT MATCHES (AGENTS.md #7). The lookup is `status:
 * 'PENDING'`, so a client who cancels an order and then orders the same thing
 * again gets a NEW order rather than having their re-order silently folded into
 * a dead row. The invoice side applies the same rule independently — see the
 * `status: { not: 'CANCELLED' }` in createInvoiceForAssignment, which is the
 * bug that shipped once already: the idempotency check found the CANCELLED
 * invoice and raised nothing, so the re-order was free.
 */
export async function placeProductOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const quantity = normaliseQuantity(input.quantity)
  const variantId = input.product.variant?.id ?? null
  // With variants the count that matters is the picked one's; the product's is
  // ignored (see stock.ts).
  const shelf = input.product.variant ? input.product.variant.stockCount : input.product.stockCount
  const label = input.product.variant
    ? `${input.product.name} — ${input.product.variant.name}`
    : input.product.name

  // The order that is already on the books for this exact thing. PENDING only:
  // a CANCELLED row is a dead order, and a FULFILLED one is a thing already
  // handed over — neither is something the next order should grow.
  const existing = await prisma.productRequest.findFirst({
    where: { clientId: input.clientId, productId: input.product.id, variantId, status: 'PENDING' },
    select: { id: true, quantity: true },
  })

  // A paid order can't grow. The client has already put money against exactly
  // this line, and quietly adding units to it would either bill them nothing
  // for the extras or rewrite an invoice they have a receipt for. Refused with
  // a reason rather than silently under-billing (AGENTS.md #4 in reverse — the
  // money that HAS moved is the trainer's decision, not a tap's).
  if (existing) {
    const paid = await prisma.invoice.findFirst({
      where: {
        trainerId: input.trainerId,
        clientId: input.clientId,
        sourceType: 'PRODUCT',
        sourceId: variantId ?? input.product.id,
        status: { in: ['PAID', 'PARTIAL'] },
      },
      select: { id: true },
    })
    if (paid) {
      return {
        ok: false,
        status: 409,
        error: `${label} has already been paid for. Hand that one over first, then order another.`,
      }
    }
  }

  // Units off the shelf, all or nothing — the whole quantity or none of it. A
  // tracked product that's short is refused HERE, so the trainer finds out at
  // the moment of ordering rather than when they go to hand it over.
  if (!(await takeStock(prisma, input.product.id, {
    clientId: input.clientId,
    userId: input.userId ?? null,
    variantId,
    note: input.stockNote,
  }, quantity))) {
    return { ok: false, status: 409, error: shortStockMessage(label, shelf, quantity) }
  }

  const request = existing
    ? await prisma.productRequest.update({
        where: { id: existing.id },
        // `increment`, not a computed value: two taps landing together must add
        // up to two rather than both writing "one more than what I read".
        data: { quantity: { increment: quantity } },
        select: { id: true, quantity: true },
      })
    : await prisma.productRequest.create({
        data: {
          clientId: input.clientId,
          productId: input.product.id,
          variantId,
          quantity,
          note: input.note ?? null,
          status: 'PENDING',
        },
        select: { id: true, quantity: true },
      })

  // The receivable for the WHOLE order — the running total, not this call's
  // increment, because there is one invoice per thing bought and it has to say
  // what is owed for it. Best-effort and never blocks the order.
  await syncOrderInvoice({
    trainerId: input.trainerId,
    clientId: input.clientId,
    productId: input.product.id,
    variantId,
    quantity: request.quantity,
  })

  return { ok: true, request, created: !existing, added: quantity }
}

/**
 * Make the receivable say what the order now says.
 *
 * Raises it the first time, and RE-PRICES it when the quantity has moved —
 * `createInvoiceForAssignment` is idempotent per thing-bought, so on its own it
 * would hand back the invoice for one harness while three sat on the order.
 *
 * Only ever touches an UNPAID invoice with a single line, which is every
 * invoice this raises. A trainer who has added lines of their own, or a client
 * who has paid, owns that invoice now; rewriting it under them is not a
 * quantity change, it is a surprise.
 */
async function syncOrderInvoice(args: {
  trainerId: string
  clientId: string
  productId: string
  variantId: string | null
  quantity: number
}): Promise<void> {
  try {
    const sourceId = args.variantId ?? args.productId
    const live = await prisma.invoice.findFirst({
      where: {
        trainerId: args.trainerId,
        clientId: args.clientId,
        sourceType: 'PRODUCT',
        sourceId,
        // A CANCELLED invoice is not a live receivable, so it must not stand in
        // for one (AGENTS.md #7). Leaving it out here is what lets the create
        // below raise a fresh one after a cancelled order.
        status: { not: 'CANCELLED' },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, amountCents: true, lines: { select: { id: true, unitAmountCents: true } } },
    })

    if (!live) {
      await createInvoiceForAssignment({
        trainerId: args.trainerId,
        clientId: args.clientId,
        sourceType: 'PRODUCT',
        productId: args.productId,
        productVariantId: args.variantId,
        quantity: args.quantity,
      })
      return
    }

    if (live.status !== 'UNPAID' || live.lines.length !== 1) return

    const line = live.lines[0]
    const amountCents = line.unitAmountCents * args.quantity
    if (amountCents === live.amountCents) return

    await prisma.$transaction([
      prisma.invoiceLineItem.update({
        where: { id: line.id },
        data: { quantity: args.quantity, amountCents },
      }),
      prisma.invoice.update({ where: { id: live.id }, data: { amountCents } }),
    ])
  } catch (err) {
    // Best-effort, exactly like createInvoiceForAssignment: a receivable that
    // fails to update must never lose the order that triggered it.
    console.error('[product-requests] syncOrderInvoice failed', args, err)
  }
}

/**
 * Undo a shop order.
 *
 * Ordering a product does three things: it takes units off the shelf, creates
 * the ProductRequest, and raises a receivable. Cancelling used to undo exactly
 * one of them — the request row — which left the client owing for something
 * they cancelled and will never receive, and the trainer's stock short with no
 * movement explaining it (audit C-3).
 *
 * IT UNDOES THE SAME NUMBER OF THINGS IT DID. A cancelled order for three puts
 * three back on the shelf, not one. That is the entire reason `quantity` is a
 * required argument here rather than an optional one with a default: a caller
 * that forgets it would silently leak stock, and a default of 1 would hide it.
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
  /** How many were on the cancelled order — the number to put back. */
  quantity: number
}): Promise<{ stockReturned: boolean; invoiceCancelled: boolean; unitsReturned: number }> {
  const units = normaliseQuantity(row.quantity)

  // Back on the shelf. Untracked stock (stockCount null) returns null and
  // writes no ledger line, which is right — there's no balance to describe.
  const balance = await returnStock(prisma, row.productId, units, {
    clientId: row.clientId,
    variantId: row.variantId,
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

  return { stockReturned: balance !== null, invoiceCancelled: !!invoice, unitsReturned: units }
}
