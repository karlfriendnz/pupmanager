import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { enforceRateLimit } from '@/lib/rate-limit'
import { hasAddon } from '@/lib/billing'
import { env } from '@/lib/env'

// A client buys a one-off combo membership: one Connect checkout with a single
// MEMBERSHIP line; the webhook grants every included item on payment. Phase 1 is
// one-off only — recurring isn't purchasable until the mandate layer ships.
export async function POST(_req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — purchase disabled' }, { status: 403 })
  const { membershipId } = await params

  const limited = await enforceRateLimit({ key: `buy-membership:${active.clientId}`, limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  const profile = await prisma.clientProfile.findUnique({ where: { id: active.clientId }, select: { id: true, trainerId: true } })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  // The trainer's Memberships add-on must be on — a switched-off trainer sells
  // nothing, even to someone holding an old link.
  if (!(await hasAddon(profile.trainerId, 'memberships'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, trainerId: profile.trainerId, published: true },
    select: { id: true, name: true, priceCents: true, cadence: true },
  })
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (membership.cadence !== 'ONE_OFF') {
    return NextResponse.json({ error: 'This is a recurring plan — not available to buy yet.' }, { status: 409 })
  }
  if (membership.priceCents <= 0) {
    return NextResponse.json({ error: 'This package has no price set.' }, { status: 409 })
  }

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: profile.trainerId },
    select: { acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: true, payoutCurrency: true, sandboxBilling: true },
  })
  if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    return NextResponse.json({ error: 'Your trainer hasn’t enabled payments yet.' }, { status: 409 })
  }
  const sandbox = trainer.sandboxBilling
  if (!isConnectConfigured(sandbox)) return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })

  const appUrl = env.NEXT_PUBLIC_APP_URL
  const { url } = await createConnectCheckout({
    sandbox,
    trainerId: profile.trainerId,
    connectAccountId: trainer.connectAccountId,
    clientId: profile.id,
    currency: trainer.payoutCurrency ?? 'nzd',
    description: membership.name,
    lines: [{ kind: 'MEMBERSHIP', description: membership.name, unitAmount: membership.priceCents, quantity: 1, intent: { membershipId: membership.id } }],
    successUrl: `${appUrl}/my-sessions?membership=1`,
    cancelUrl: `${appUrl}/my-memberships?cancelled=1`,
  })
  if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  return NextResponse.json({ ok: true, mode: 'payment', url }, { status: 201 })
}
