import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { enforceRateLimit } from '@/lib/rate-limit'
import { hasAddon } from '@/lib/billing'
import { notifyTrainer } from '@/lib/trainer-notify'

// "Request this" for a membership the client CAN'T check out themselves.
//
// Two things get sold on the client storefront that the buy route refuses: a
// RECURRING plan (there's no mandate layer yet, so it 409s) and one published
// without a price. Both used to be a dead end — a sentence telling the client to
// go and message their trainer. This turns that into one tap, and tells the
// trainer what the client wants.
//
// It deliberately mirrors POST /api/my/products/[productId]/request, the shop's
// existing "request this" path: a PENDING row, idempotent on repeat taps, and
// the SAME CLIENT_SHOP_ORDER notification — that type is documented as "a client
// bought or requested one of your shop products" and carries a free-form
// `detail`, so it already means "someone wants to buy a thing you sell". No new
// notification type is needed.

async function resolveActingClient() {
  const active = await getActiveClient()
  if (!active) return null
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true, trainerId: true,
      user: { select: { name: true } },
      dog: { select: { name: true } },
      trainer: { select: { user: { select: { id: true } } } },
      assignedTrainer: { select: { user: { select: { id: true } } } },
    },
  })
  // A trainer walking their own client app must not notify themselves.
  return profile ? { ...profile, isPreview: active.isPreview } : null
}

export async function POST(_req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const profile = await resolveActingClient()
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { membershipId } = await params

  const limited = await enforceRateLimit({ key: `request-membership:${profile.id}`, limit: 20, windowMs: 10 * 60_000 })
  if (limited) return limited

  // Same add-on gate as the buy route: a trainer with Memberships switched off
  // sells nothing, so there is nothing to ask for either.
  if (!(await hasAddon(profile.trainerId, 'memberships'))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Tenant-scoped: a membership id from another trainer resolves to nothing.
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, trainerId: profile.trainerId, published: true },
    select: { id: true, name: true, priceCents: true, cadence: true },
  })
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Only for what can't be bought. Anything checkout WOULD take must go through
  // checkout — otherwise "request" becomes a way to skip paying.
  const reason = membership.cadence !== 'ONE_OFF'
    ? 'RECURRING' as const
    : membership.priceCents <= 0
      ? 'NO_PRICE' as const
      : null
  if (!reason) {
    return NextResponse.json({ error: 'This package can be bought directly.' }, { status: 409 })
  }

  // Idempotent. A second tap (or a second device) returns the row that already
  // exists and sends no further notification — the trainer gets told once.
  const existing = await prisma.membershipRequest.findFirst({
    where: { clientId: profile.id, membershipId, status: 'PENDING' },
  })
  if (existing) return NextResponse.json({ ok: true, alreadyRequested: true, request: existing })

  const created = await prisma.membershipRequest.create({
    data: { clientId: profile.id, membershipId, reason, status: 'PENDING' },
  })

  const trainerUserId = profile.assignedTrainer?.user?.id ?? profile.trainer?.user?.id ?? null
  if (trainerUserId && !profile.isPreview) {
    // The two reasons are different jobs, so they read differently.
    const detail = reason === 'RECURRING'
      ? `asked about the ongoing plan “${membership.name}” — it needs setting up`
      : `asked about “${membership.name}” — it has no price yet`
    await notifyTrainer(
      trainerUserId,
      'CLIENT_SHOP_ORDER',
      { clientName: profile.user?.name ?? 'A client', dogName: profile.dog?.name ?? '', detail },
      `/clients/${profile.id}`,
      profile.trainerId,
    ).catch(err => console.error('[membership request] notify failed', err))
  }

  return NextResponse.json({ ok: true, alreadyRequested: false, request: created }, { status: 201 })
}

// Undo — clears the PENDING row so the card offers "Request this" again.
export async function DELETE(_req: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const profile = await resolveActingClient()
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { membershipId } = await params

  // Scoped by clientId, so this can only ever clear the caller's own row.
  await prisma.membershipRequest.deleteMany({
    where: { clientId: profile.id, membershipId, status: 'PENDING' },
  })
  return NextResponse.json({ ok: true })
}
