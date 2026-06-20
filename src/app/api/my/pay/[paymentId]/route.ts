import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { mintCheckoutSession } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { enforceRateLimit } from '@/lib/rate-limit'
import { env } from '@/lib/env'

// Mint a Stripe Checkout Session for a trainer-issued invoice the client is
// paying. The Payment already exists (PENDING); we create the hosted session on
// demand so the emailed pay link never expires.
export async function POST(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — payment disabled' }, { status: 403 })

  const limited = await enforceRateLimit({ key: `pay:${active.clientId}`, limit: 20, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { paymentId } = await params

  // Scope strictly to the acting client's own invoice.
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, clientId: active.clientId },
    select: { id: true, status: true, sandbox: true },
  })
  if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (payment.status !== 'PENDING') {
    return NextResponse.json({ error: 'This payment is already settled.' }, { status: 409 })
  }
  if (!isConnectConfigured(payment.sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  const base = `${env.NEXT_PUBLIC_APP_URL}/my/pay/${payment.id}`
  const url = await mintCheckoutSession(payment.id, { successUrl: `${base}?paid=1`, cancelUrl: base })
  if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  return NextResponse.json({ url })
}
