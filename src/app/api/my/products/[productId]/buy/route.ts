import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { resolveRequirePayment } from '@/lib/require-payment'
import { enforceRateLimit } from '@/lib/rate-limit'
import { notifyTrainer } from '@/lib/trainer-notify'
import { env } from '@/lib/env'

// Buy a shop product (Flow B, Phase 2). The sibling /request route stays for
// unpriced products / trainers who haven't switched payments on. On success the
// connect webhook marks the Payment paid and creates a FULFILLED ProductRequest.

async function resolveActingClient() {
  const active = await getActiveClient()
  if (!active) return null
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true, trainerId: true,
      // Names + trainer routing for the "shop order" notification.
      user: { select: { name: true } },
      dog: { select: { name: true } },
      trainer: { select: { user: { select: { id: true } } } },
      assignedTrainer: { select: { user: { select: { id: true } } } },
    },
  })
  return profile ? { ...profile, isPreview: active.isPreview } : null
}

export async function POST(req: Request, { params }: { params: Promise<{ productId: string }> }) {
  const profile = await resolveActingClient()
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // A trainer previewing the client app must never trigger a real charge.
  if (profile.isPreview) return NextResponse.json({ error: 'Preview mode — payment disabled' }, { status: 403 })

  // Cap abuse: each Buy creates a PENDING Payment + Stripe session before any
  // money moves, so rate-limit per acting client.
  const limited = await enforceRateLimit({ key: `buy:${profile.id}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { productId } = await params

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, trainerId: true, active: true, name: true, kind: true, priceCents: true, requirePayment: true },
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
      defaultRequirePayment: true,
    },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    // Payments off — unchanged: the client uses the /request (pay-later) route.
    return NextResponse.json({ error: 'This trainer isn’t taking payments yet.' }, { status: 409 })
  }

  // Payments ON but this product resolves to "don't require payment" — book now,
  // pay later: create a PENDING request (idempotent) and raise a receivable
  // instead of charging a card. Mirrors the /request route.
  if (!resolveRequirePayment(product.requirePayment, trainer.defaultRequirePayment)) {
    const existing = await prisma.productRequest.findFirst({
      where: { clientId: profile.id, productId: product.id, status: 'PENDING' },
      select: { id: true },
    })
    if (!existing) {
      await prisma.productRequest.create({
        data: { clientId: profile.id, productId: product.id, status: 'PENDING' },
      })
    }
    await createInvoiceForAssignment({
      trainerId: profile.trainerId,
      clientId: profile.id,
      sourceType: 'PRODUCT',
      productId: product.id,
    })
    // Tell the trainer their client bought this item (book-now-pay-later path).
    // The card-checkout path below finishes in the connect webhook, so it isn't
    // notified here — that completion lives outside this route.
    const trainerUserId = profile.assignedTrainer?.user?.id ?? profile.trainer?.user?.id ?? null
    if (trainerUserId) {
      await notifyTrainer(
        trainerUserId,
        'CLIENT_SHOP_ORDER',
        { clientName: profile.user?.name ?? 'A client', dogName: profile.dog?.name ?? '', detail: `bought “${product.name}”` },
        `/clients/${profile.id}`,
        profile.trainerId,
      )
    }
    return NextResponse.json({ ok: true, mode: 'requested' })
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
