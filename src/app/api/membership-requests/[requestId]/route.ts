import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { trainerRequestScope } from '@/lib/membership-requests'
import { fulfilMembershipInTx, enrolMembershipClasses } from '@/lib/memberships'
import { notifyClient } from '@/lib/client-notify'
import { safeEvaluate } from '@/lib/achievements'

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
  status: z.enum(['FULFILLED', 'DECLINED']),
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
  if (request.status !== 'PENDING') {
    return NextResponse.json({ ok: true, alreadyActioned: true, status: request.status })
  }

  if (parsed.data.status === 'DECLINED') {
    await prisma.membershipRequest.update({
      where: { id: requestId },
      data: { status: 'DECLINED', fulfilledAt: null },
    })
    return NextResponse.json({ ok: true, status: 'DECLINED' })
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
