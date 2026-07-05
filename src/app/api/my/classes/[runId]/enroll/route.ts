import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import {
  enrollInRun, ClassError, decideEnrollment, effectiveCapacity, enrolledCount, dropInPriceCents,
} from '@/lib/class-runs'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { resolveRequirePayment } from '@/lib/require-payment'
import { enforceRateLimit } from '@/lib/rate-limit'
import { env } from '@/lib/env'

// Client self-enrolment into a group class run. Free classes (or trainers not
// taking payments) enrol straight away; a priced class with payments on is
// pay-to-confirm — the connect webhook enrols on success.

const schema = z.object({
  type: z.enum(['FULL', 'DROP_IN']).optional(),
  dogId: z.string().min(1).nullable().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — enrolment disabled' }, { status: 403 })

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true, dogId: true, dogs: { select: { id: true } } },
  })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const limited = await enforceRateLimit({ key: `enroll:${profile.id}`, limit: 12, windowMs: 10 * 60_000 })
  if (limited) return limited

  const { runId } = await params

  const run = await prisma.classRun.findFirst({
    where: { id: runId, trainerId: profile.trainerId },
    include: { package: true },
  })
  if (!run || !run.package.isGroup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (run.status === 'CANCELLED' || run.status === 'COMPLETED') {
    return NextResponse.json({ error: 'This class is no longer taking enrolments.' }, { status: 409 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const type = parsed.data.type ?? 'FULL'
  if (type === 'DROP_IN' && !run.package.allowDropIn) {
    return NextResponse.json({ error: 'This class doesn’t allow drop-ins.' }, { status: 400 })
  }

  // Default to the client's primary dog; only honour a supplied dog they own.
  const ownDogIds = new Set([profile.dogId, ...profile.dogs.map(d => d.id)].filter(Boolean) as string[])
  const dogId = parsed.data.dogId ?? profile.dogId
  if (parsed.data.dogId && !ownDogIds.has(parsed.data.dogId)) {
    return NextResponse.json({ error: 'That dog isn’t on your account.' }, { status: 400 })
  }

  // Already enrolled? (the unique index also enforces this.)
  const existing = await prisma.classEnrollment.findFirst({
    where: { classRunId: runId, clientId: profile.id, dogId: dogId ?? null },
    select: { status: true },
  })
  if (existing && existing.status !== 'WITHDRAWN') {
    return NextResponse.json({ error: 'You’re already enrolled in this class.' }, { status: 409 })
  }

  // Price the enrolment.
  let price: number | null
  if (type === 'FULL') {
    price = run.package.specialPriceCents ?? run.package.priceCents
  } else {
    const next = await prisma.trainingSession.findFirst({
      where: { classRunId: runId, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      select: { sessionIndex: true },
    })
    price = dropInPriceCents({
      dropInPriceCents: run.package.dropInPriceCents,
      sessionCount: run.package.sessionCount,
      joinedAtIndex: next?.sessionIndex ?? 1,
    })
  }

  // Pay-to-confirm only when there's a real seat to pay for.
  const seatDecision = decideEnrollment({
    capacity: effectiveCapacity(run.capacity, run.package.capacity),
    enrolledCount: await enrolledCount(runId),
    allowWaitlist: run.package.allowWaitlist,
  })

  // Whether a priced ENROLLED seat should be charged up front. Only meaningful
  // when the trainer can take cards — resolved below inside that guard.
  let payLater = false
  if (price && price > 0 && seatDecision === 'ENROLLED') {
    const trainer = await prisma.trainerProfile.findUnique({
      where: { id: profile.trainerId },
      select: { acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: true, payoutCurrency: true, sandboxBilling: true, defaultRequirePayment: true },
    })
    if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
      // Payments off — unchanged.
      return NextResponse.json({ error: 'This class needs payment, which your trainer hasn’t enabled yet.' }, { status: 409 })
    }
    // Require-payment off for this class → enrol now, invoice later (fall through
    // to the enrolment below instead of Stripe checkout).
    if (!resolveRequirePayment(run.requirePayment, trainer.defaultRequirePayment)) {
      payLater = true
    }
    const sandbox = trainer.sandboxBilling
    if (!payLater && !isConnectConfigured(sandbox)) {
      return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
    }
    if (!payLater) {
      const classesUrl = `${env.NEXT_PUBLIC_APP_URL}/my-classes`
      const { url } = await createConnectCheckout({
        sandbox,
        trainerId: profile.trainerId,
        connectAccountId: trainer.connectAccountId,
        clientId: profile.id,
        currency: trainer.payoutCurrency ?? 'nzd',
        description: `${run.name}${type === 'DROP_IN' ? ' (drop-in)' : ''}`,
        lines: [
          {
            kind: 'CLASS_ENROLLMENT',
            description: `${run.name}${type === 'DROP_IN' ? ' (drop-in)' : ''}`,
            unitAmount: price,
            quantity: 1,
            intent: { classRunId: runId, type, dogId: dogId ?? null },
          },
        ],
        successUrl: `${classesUrl}?enrol=success`,
        cancelUrl: `${classesUrl}?enrol=cancelled`,
      })
      if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
      return NextResponse.json({ ok: true, mode: 'payment', url }, { status: 201 })
    }
    // payLater: fall through to the enrolment below, then raise a receivable.
  }

  // A priced class with no seat free can't be paid for — fall through to a free
  // waitlist if the package allows one; otherwise the enrol below rejects.
  if (price && price > 0 && seatDecision === 'REJECTED_FULL') {
    return NextResponse.json({ error: 'This class is full.' }, { status: 409 })
  }

  // Free (or waitlist) enrolment — straight in. A priced pay-later enrolment
  // (require-payment off) also lands here: we enrol, then raise a receivable.
  try {
    const result = await enrollInRun({ classRunId: runId, clientId: profile.id, dogId: dogId ?? null, type, source: 'SELF_SERVE' })
    if (payLater && result.status === 'ENROLLED') {
      await prisma.classEnrollment.update({ where: { id: result.enrollmentId }, data: { invoicedAt: new Date() } }).catch(() => {})
      await createInvoiceForAssignment({
        trainerId: profile.trainerId,
        clientId: profile.id,
        sourceType: 'CLASS_ENROLLMENT',
        classEnrollmentId: result.enrollmentId,
      })
    }
    return NextResponse.json({ ok: true, mode: result.status === 'WAITLISTED' ? 'waitlisted' : 'enrolled' }, { status: 201 })
  } catch (err) {
    if (err instanceof ClassError) {
      const status = err.code === 'FULL' || err.code === 'ALREADY_ENROLLED' || err.code === 'RUN_CLOSED' ? 409 : 400
      return NextResponse.json({ error: err.message }, { status })
    }
    throw err
  }
}
