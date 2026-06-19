import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { env } from '@/lib/env'

// Buy a shop product (Flow B, Phase 2). The sibling /request route stays for
// unpriced products / trainers who haven't switched payments on. On success the
// connect webhook marks the Payment paid and creates a FULFILLED ProductRequest.

async function resolveActingClient() {
  const active = await getActiveClient()
  if (!active) return null
  return prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true },
  })
}

export async function POST(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const profile = await resolveActingClient()
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { productId } = await params

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, trainerId: true, active: true, name: true, kind: true, priceCents: true },
  })
  if (!product || product.trainerId !== profile.trainerId || !product.active) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!product.priceCents || product.priceCents <= 0) {
    return NextResponse.json({ error: 'This item isn’t for sale online.' }, { status: 400 })
  }

  // Apple: no in-app purchase of digital goods. We hide the button in the
  // native app; this is the server-side backstop — the app reports itself via
  // x-pm-platform, and a digital buy from iOS/Android is refused.
  const platform = req.headers.get('x-pm-platform')
  if (product.kind === 'DIGITAL' && (platform === 'ios' || platform === 'android')) {
    return NextResponse.json({ error: 'Digital items can only be bought on the web.' }, { status: 403 })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: profile.trainerId },
    select: {
      acceptPaymentsEnabled: true,
      connectChargesEnabled: true,
      connectAccountId: true,
      payoutCurrency: true,
      sandboxBilling: true,
    },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    return NextResponse.json({ error: 'This trainer isn’t taking payments yet.' }, { status: 409 })
  }

  const sandbox = trainer.sandboxBilling
  if (!isConnectConfigured(sandbox)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  const currency = trainer.payoutCurrency ?? 'nzd'
  const shop = `${env.NEXT_PUBLIC_APP_URL}/my-shop`

  const { url } = await createConnectCheckout({
    sandbox,
    trainerId: profile.trainerId,
    connectAccountId: trainer.connectAccountId,
    clientId: profile.id,
    currency,
    description: product.name,
    lines: [
      {
        kind: 'PRODUCT',
        description: product.name,
        unitAmount: product.priceCents,
        quantity: 1,
        productId: product.id,
        intent: { productId: product.id, quantity: 1 },
      },
    ],
    successUrl: `${shop}?purchase=success`,
    cancelUrl: `${shop}?purchase=cancelled`,
  })

  if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  return NextResponse.json({ url })
}
