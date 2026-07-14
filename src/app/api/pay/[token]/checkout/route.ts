import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { env } from '@/lib/env'

// PUBLIC (no-login) checkout for the invoice pay page (/pay/<token>). Mints a
// Stripe Checkout Session as a DIRECT charge on the invoice's trainer's Connect
// account — the same Flow-B path products/packages use (mintCheckoutSession
// only mints when the trainer's Connect account can actually charge). The amount is ALWAYS recomputed
// server-side from the invoice; no client-supplied amount is ever trusted.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  // Unauthenticated + money → rate-limit by IP (mirrors the public form limiter).
  const limited = await enforceRateLimit({ key: `pay:${getClientIp(req)}`, limit: 15, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { token } = await params
  if (!token || token.length < 8) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const invoice = await prisma.invoice.findUnique({
    where: { payToken: token },
    select: {
      id: true, amountCents: true, amountPaidCents: true, currency: true, status: true, description: true,
      clientId: true, payToken: true,
      trainer: {
        select: {
          id: true, connectAccountId: true, acceptPaymentsEnabled: true, connectChargesEnabled: true, sandboxBilling: true,
        },
      },
    },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only still-open invoices are payable.
  if (invoice.status !== 'UNPAID' && invoice.status !== 'PARTIAL') {
    return NextResponse.json({ error: 'This invoice is not payable.' }, { status: 409 })
  }

  // Recompute the balance SERVER-SIDE — the client never supplies an amount.
  const balance = invoice.amountCents - invoice.amountPaidCents
  if (balance <= 0) return NextResponse.json({ error: 'Nothing left to pay.' }, { status: 409 })

  const trainer = invoice.trainer
  if (!trainer.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    return NextResponse.json({ error: 'This trainer isn’t taking card payments yet.' }, { status: 409 })
  }
  const sandbox = trainer.sandboxBilling
  if (!isConnectConfigured(sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  const base = `${env.NEXT_PUBLIC_APP_URL}/pay/${invoice.payToken}`
  const { url } = await createConnectCheckout({
    sandbox,
    trainerId: trainer.id,
    connectAccountId: trainer.connectAccountId,
    clientId: invoice.clientId,
    currency: invoice.currency,
    description: invoice.description ?? 'Invoice',
    lines: [
      {
        // PRODUCT with no productId is inert at fulfilment — the invoiceId
        // metadata is what drives settlement in the webhook.
        kind: 'PRODUCT',
        description: invoice.description ?? 'Invoice',
        unitAmount: balance,
        quantity: 1,
        intent: { invoicePayment: true, invoiceId: invoice.id },
      },
    ],
    // Carried on the Checkout Session + PaymentIntent so the webhook can settle
    // the right invoice.
    metadata: { invoiceId: invoice.id },
    successUrl: `${base}?paid=1`,
    cancelUrl: base,
  })
  if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  return NextResponse.json({ url })
}
