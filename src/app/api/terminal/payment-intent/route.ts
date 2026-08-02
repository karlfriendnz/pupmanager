import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireSameOrigin } from '@/lib/csrf'
import { createPaymentRecord } from '@/lib/connect-checkout'
import { createCardPresentPaymentIntent } from '@/lib/terminal'
import { guardTapToPay } from '../_guard'

// The PaymentIntent a tap is collected against.
//
// This is the Tap to Pay sibling of connect-checkout's `mintCheckoutSession`,
// and it deliberately reuses that module's `createPaymentRecord` rather than
// writing its own Payment rows. Everything downstream — the fee, the
// pass-the-card-fee-on surcharge, the PaymentItem snapshots, the earnings
// ledger, and above all the `payment_intent.succeeded` webhook that actually
// delivers what was bought — then behaves identically whether the client
// scanned a QR or tapped a card. A second Payment-writing path here is exactly
// how the two would drift.
//
// Two ways in, matching the two things a trainer sells in person:
//   - `invoiceId`  settle an open invoice (a normal client sale)
//   - `lines`      a walk-up with no account, like the guest sale
//
// The amount is ALWAYS computed server-side. A client-supplied total on an
// endpoint that charges a real card is not a shortcut worth having.

const lineSchema = z.object({
  description: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(1000),
  unitAmountCents: z.number().int().min(0).max(10_000_000),
})

const bodySchema = z
  .object({
    invoiceId: z.string().min(1).optional(),
    lines: z.array(lineSchema).min(1).max(50).optional(),
  })
  .refine(d => (d.invoiceId ? !d.lines : !!d.lines), {
    message: 'Supply either invoiceId or lines, not both',
  })

export async function POST(req: Request) {
  const csrf = requireSameOrigin(req); if (csrf) return csrf
  const guard = await guardTapToPay()
  if (guard instanceof NextResponse) return guard

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

  let paymentId: string
  let amount: number
  let currency: string
  let description: string
  let metadata: Record<string, string> = {}

  if (parsed.data.invoiceId) {
    // Scoped to THIS trainer in the where clause, not checked afterwards — an
    // invoice id from another business must not even be readable here.
    const invoice = await prisma.invoice.findFirst({
      where: { id: parsed.data.invoiceId, trainerId: guard.trainerId },
      select: {
        id: true, amountCents: true, amountPaidCents: true, currency: true,
        status: true, description: true, clientId: true,
      },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (invoice.status !== 'UNPAID' && invoice.status !== 'PARTIAL') {
      return NextResponse.json({ error: 'This invoice is not payable.' }, { status: 409 })
    }

    const balance = invoice.amountCents - invoice.amountPaidCents
    if (balance <= 0) return NextResponse.json({ error: 'Nothing left to pay.' }, { status: 409 })

    currency = invoice.currency
    description = invoice.description ?? 'Invoice'
    metadata = { invoiceId: invoice.id }
    paymentId = await createPaymentRecord({
      sandbox: guard.sandbox,
      trainerId: guard.trainerId,
      connectAccountId: guard.connectAccountId,
      clientId: invoice.clientId,
      currency,
      description,
      lines: [
        {
          // PRODUCT with no productId is inert at fulfilment; the invoiceId in
          // `intent` + metadata is what settles the invoice. Same shape the
          // public pay page uses, on purpose.
          kind: 'PRODUCT',
          description,
          unitAmount: balance,
          quantity: 1,
          intent: { invoicePayment: true, invoiceId: invoice.id },
        },
      ],
    })
  } else {
    const lines = parsed.data.lines!
    const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitAmountCents, 0)
    if (subtotal <= 0) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

    currency = guard.currency
    description = lines.length === 1
      ? lines[0].description
      : `${lines[0].description} +${lines.length - 1} more`
    paymentId = await createPaymentRecord({
      sandbox: guard.sandbox,
      trainerId: guard.trainerId,
      connectAccountId: guard.connectAccountId,
      // No client row, and therefore nothing to fulfil — see the guest sale
      // route for why productId/intent are deliberately absent.
      clientId: null,
      currency,
      description,
      lines: lines.map(l => ({
        kind: 'PRODUCT' as const,
        description: l.description,
        unitAmount: l.unitAmountCents,
        quantity: l.quantity,
      })),
    })
  }

  // createPaymentRecord may have appended a card-fee surcharge line, so the
  // total to charge is read back off the Payment rather than recomputed here.
  // Recomputing it is how the tap ends up charging a different number from the
  // one the ledger is expecting.
  const payment = await prisma.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { amountTotal: true, currency: true, applicationFeeAmount: true },
  })
  amount = payment.amountTotal
  currency = payment.currency

  const intent = await createCardPresentPaymentIntent({
    sandbox: guard.sandbox,
    connectAccountId: guard.connectAccountId,
    amount,
    currency,
    // Our cut as the Payment row already recorded it, so the earnings ledger and
    // Stripe cannot disagree about what we took.
    applicationFeeAmount: payment.applicationFeeAmount,
    paymentId,
    description,
    metadata,
  })

  await prisma.payment.update({
    where: { id: paymentId },
    data: { stripePaymentIntentId: intent.id },
  })

  // client_secret is what the SDK collects against; it is scoped to this one
  // intent on this one connected account and is useless without a tap.
  return NextResponse.json({
    paymentId,
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amount,
    currency,
  })
}
