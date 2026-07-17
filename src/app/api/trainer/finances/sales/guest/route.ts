import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { env } from '@/lib/env'

// Guest sale — someone buying on the spot who isn't (and needn't become) a
// client. A stranger at a class buying a treat pouch shouldn't have to hand
// over their details first.
//
// Deliberately NOT an Invoice, unlike the normal instant sale: `Invoice.clientId`
// is required (with a required relation), so a client-less invoice would need a
// migration plus changes everywhere that assumes an invoice has someone attached
// — the pay page, the invoice email, the Xero contact sync. `Payment.clientId`
// is already nullable, so the payment ledger models this today. We go straight
// to a Stripe Checkout Session and hand back its URL for the composer to render
// as a QR.
//
// Consequences of having no client, both intentional:
//   - Card only. There's no "record it, pay later" — nobody to invoice or chase.
//   - Requires Stripe connected. Without it there's no way to take the money.
const postSchema = z.object({
  lines: z
    .array(
      z.object({
        description: z.string().min(1).max(200),
        quantity: z.number().int().min(1).max(1000),
        unitAmountCents: z.number().int().min(0).max(10_000_000),
      }),
    )
    .min(1)
    .max(50),
})

export async function POST(req: Request) {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  if (!(await hasAddon(ctx.companyId, 'pos'))) {
    return NextResponse.json({ error: 'ADDON_REQUIRED' }, { status: 403 })
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: {
      acceptPaymentsEnabled: true,
      connectChargesEnabled: true,
      connectAccountId: true,
      payoutCurrency: true,
      sandboxBilling: true,
    },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    // No card payments = no way to complete a guest sale, since there's no one
    // to invoice. The composer steers them to a normal (client) sale instead.
    return NextResponse.json({ error: 'PAYMENTS_REQUIRED' }, { status: 409 })
  }

  const sandbox = trainer.sandboxBilling
  if (!isConnectConfigured(sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  const lines = parsed.data.lines
  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitAmountCents, 0)
  if (total <= 0) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  const description = lines.length === 1
    ? lines[0].description
    : `${lines[0].description} +${lines.length - 1} more`

  const thanks = `${env.NEXT_PUBLIC_APP_URL}/sale/thanks`

  const { url } = await createConnectCheckout({
    sandbox,
    trainerId: ctx.companyId,
    connectAccountId: trainer.connectAccountId,
    // The whole point: no client row.
    clientId: null,
    currency: trainer.payoutCurrency ?? 'nzd',
    description,
    // NOTE: no `productId` and no `intent`, even for a line picked out of the
    // catalogue. The Connect webhook fulfils on `kind === 'PRODUCT' && productId`
    // by creating a ProductRequest with `clientId: payment.clientId` — which is
    // null here, and ProductRequest.clientId is required. Passing productId
    // would throw inside the fulfilment transaction AFTER the customer had
    // paid. Omitting it skips that branch: the line stays a priced snapshot for
    // the earnings ledger, and there's correctly nothing to fulfil — a guest has
    // no account to deliver anything to. See tests/unit/security/guest-sale-route.
    lines: lines.map((l) => ({
      kind: 'PRODUCT' as const,
      description: l.description,
      unitAmount: l.unitAmountCents,
      quantity: l.quantity,
    })),
    successUrl: `${thanks}?paid=1`,
    cancelUrl: `${thanks}?cancelled=1`,
  })

  if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  return NextResponse.json({ url, amountCents: total })
}
