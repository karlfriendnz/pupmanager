import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { trainerRequestScope } from '@/lib/membership-requests'
import { fulfilMembershipInTx, enrolMembershipClasses } from '@/lib/memberships'
import { notifyClient } from '@/lib/client-notify'
import { safeEvaluate } from '@/lib/achievements'
import { canChargeRecurring, RECURRING_CAPABILITY_SELECT } from '@/lib/connect'

// The trainer acting on a client's "Request this" for a package checkout can't
// take. Deliberately shaped like PATCH /api/product-requests/[requestId], the
// shop's equivalent: same verb, same body, same two outcomes, same 404-on-
// another-tenant's-row.
//
// The one difference is what accepting means. A product request is fulfilled
// when the trainer hands the thing over. A package request is fulfilled by
// putting the client ON the package — so this reuses fulfilMembershipInTx, the
// SAME grant the Stripe webhook runs, rather than inventing a second assignment
// mechanism. It passes paymentId: null, because no money has been taken and the
// record must not pretend otherwise.

const patchSchema = z.object({
  // INVITED is the third answer, and the one recurring billing makes possible:
  // rather than granting an ongoing plan for free, ask the client to subscribe
  // and pay for it. Kept distinct from FULFILLED so the trainer's list can tell
  // "I gave it to them" apart from "I'm waiting for them to pay".
  status: z.enum(['FULFILLED', 'DECLINED', 'INVITED']),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const ctx = await guardPermission('packages.manage')
  if (ctx instanceof NextResponse) return ctx
  const trainerId = ctx.companyId

  const { requestId } = await params

  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  // findFirst + the shared tenant scope, not findUnique-then-check: another
  // trainer's request id resolves to nothing at all, so it can't be actioned
  // and its client/package names never reach the response.
  const request = await prisma.membershipRequest.findFirst({
    where: { id: requestId, ...trainerRequestScope(trainerId) },
    select: {
      id: true,
      status: true,
      clientId: true,
      membershipId: true,
      client: { select: { userId: true, dog: { select: { name: true } } } },
      membership: { select: { name: true } },
    },
  })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Already decided — return it rather than granting the package twice because
  // two tabs were open.
  //
  // INVITED is the exception, and only for DECLINED: withdrawing an invitation
  // is a real thing a trainer needs to do (they sorted it in person, the client
  // changed their mind), and it is SAFE precisely because inviting granted
  // nothing and charged nothing. There is no purchase to unwind, no package to
  // take back and no Stripe object to cancel — the row simply closes. Any live
  // subscription the client did start is untouched by this: it is a
  // MembershipPurchase, and its own cancellation route is the only thing that
  // stops money moving.
  const withdrawingInvite = request.status === 'INVITED' && parsed.data.status === 'DECLINED'
  if (request.status !== 'PENDING' && !withdrawingInvite) {
    return NextResponse.json({ ok: true, alreadyActioned: true, status: request.status })
  }

  if (parsed.data.status === 'DECLINED') {
    // updateMany + the status guard, so two tabs declining at once (or a decline
    // racing an accept) settles on one answer instead of stamping over a grant.
    const declined = await prisma.membershipRequest.updateMany({
      where: { id: requestId, status: { in: ['PENDING', 'INVITED'] } },
      data: { status: 'DECLINED', fulfilledAt: null },
    })
    if (declined.count === 0) {
      return NextResponse.json({ ok: true, alreadyActioned: true, status: request.status })
    }
    return NextResponse.json({ ok: true, status: 'DECLINED' })
  }

  // ── Invite them to subscribe ──────────────────────────────────────────────
  // Nothing is granted and no money moves here: the client is pointed at the
  // storefront to subscribe themselves, which is the whole point of recurring
  // billing existing. Only offered for a plan they can actually buy — inviting
  // someone to pay for something checkout would refuse is a dead end, and the
  // trainer would never find out why.
  if (parsed.data.status === 'INVITED') {
    const trainerForInvite = await prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { ...RECURRING_CAPABILITY_SELECT, businessName: true },
    })
    const membership = await prisma.membership.findFirst({
      where: { id: request.membershipId, trainerId },
      select: {
        cadence: true,
        // Current AND priced. An archived plan can never start a new
        // subscription, and the buy route refuses a zero-priced one with "This
        // package has no price set" — either would send the client to a button
        // that fails, which is the one thing this branch must never do.
        plans: { where: { archivedAt: null, priceCents: { gt: 0 } }, select: { id: true } },
      },
    })

    // Gate on the FACT — can this trainer actually take a recurring card
    // payment — not on the recurringPaymentsEnabled allowlist alone. That flag
    // being true says a trainer is permitted to sell subscriptions; it says
    // nothing about whether Stripe will accept a charge. An allowlisted trainer
    // with no connected account (or one restricted mid-verification) would be
    // told the invitation was sent, and their client would tap through to a 409
    // neither of them could do anything about. AGENTS.md #6.
    if (membership?.cadence !== 'RECURRING' || !membership.plans.length || !canChargeRecurring(trainerForInvite ?? {})) {
      return NextResponse.json(
        {
          error: canChargeRecurring(trainerForInvite ?? {})
            ? 'This package can’t be subscribed to yet — set up an ongoing price first.'
            : 'You need Stripe connected before you can ask a client to pay for a plan.',
        },
        { status: 409 },
      )
    }

    const claimed = await prisma.membershipRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'INVITED', fulfilledAt: new Date() },
    })
    if (claimed.count === 0) {
      return NextResponse.json({ ok: true, alreadyActioned: true, status: 'INVITED' })
    }

    if (request.client.userId) {
      await notifyClient({
        userId: request.client.userId,
        trainerId,
        type: 'CLIENT_ADDED_TO_PLAN',
        vars: {
          trainerName: trainerForInvite?.businessName ?? 'Your trainer',
          dogName: request.client.dog?.name ?? 'you',
          planName: request.membership.name,
          detail: 'It’s ready for you to start — tap to see the price and subscribe.',
        },
        // Deep-linked to THIS package, which opens its consent screen on
        // arrival. Deliberately NOT a Stripe Checkout URL minted here: the
        // subscription must be authorised by the client, and the consent row
        // the buy route writes is their recorded agreement to a repeating
        // charge. Creating a session on their behalf would be us agreeing to it
        // for them — and the link would be a bearer token for a live payment
        // page sitting in an email. One code path through money: they go to the
        // same Subscribe button as everyone else.
        link: `/my-memberships?plan=${request.membershipId}`,
        ctaLabel: 'See the plan',
      }).catch(err => console.error('[membership request] invite notify failed', err))
    }

    return NextResponse.json({ ok: true, status: 'INVITED' })
  }

  // ── Accept ────────────────────────────────────────────────────────────────
  // Sandbox mirrors the trainer's billing mode so a granted purchase is filed
  // with their payments rather than straddling both sets of books.
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { sandboxBilling: true, businessName: true },
  })

  const { classGrants } = await prisma.$transaction(async tx => {
    // Re-check PENDING inside the transaction so two simultaneous accepts can't
    // both grant. The second updates 0 rows and grants nothing.
    const claimed = await tx.membershipRequest.updateMany({
      where: { id: requestId, status: 'PENDING' },
      data: { status: 'FULFILLED', fulfilledAt: new Date() },
    })
    if (claimed.count === 0) return { classGrants: [] }

    return fulfilMembershipInTx(tx, {
      membershipId: request.membershipId,
      trainerId,
      clientId: request.clientId,
      // No payment exists. Nothing was charged — see paymentCaveat().
      paymentId: null,
      sandbox: trainer?.sandboxBilling ?? false,
    })
  })

  // Class places enrol after the commit — enrollInRun opens its own transaction.
  if (classGrants.length) await enrolMembershipClasses(classGrants, request.clientId)

  // Best-effort, exactly as elsewhere: neither of these may fail the accept.
  await safeEvaluate(request.clientId).catch(() => {})
  if (request.client.userId) {
    // CLIENT_ADDED_TO_PLAN is literally "trainer added the client to a session /
    // package / class". It says nothing about payment, which is correct — the
    // trainer settles that separately.
    await notifyClient({
      userId: request.client.userId,
      trainerId,
      type: 'CLIENT_ADDED_TO_PLAN',
      vars: {
        trainerName: trainer?.businessName ?? 'Your trainer',
        // The body reads "{{trainerName}} added {{dogName}} to {{planName}}" —
        // "you" keeps it a sentence for a client with no dog on file.
        dogName: request.client.dog?.name ?? 'you',
        planName: request.membership.name,
      },
      link: '/my-memberships',
    })
  }

  return NextResponse.json({ ok: true, status: 'FULFILLED' })
}
