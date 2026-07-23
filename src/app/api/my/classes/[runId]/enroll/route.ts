import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import {
  enrollInRun, ClassError, decideEnrollment, effectiveCapacity, enrolledCount,
  sessionAttendeeCount, sessionDropInPriceCents, sessionCapacity,
} from '@/lib/class-runs'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { resolveRequirePayment } from '@/lib/require-payment'
import { enforceRateLimit } from '@/lib/rate-limit'
import { notifyTrainer } from '@/lib/trainer-notify'
import { notifyClient } from '@/lib/client-notify'
import { env } from '@/lib/env'

// Client self-enrolment into a group class run. Free classes (or trainers not
// taking payments) enrol straight away; a priced class with payments on is
// pay-to-confirm — the connect webhook enrols on success.

const schema = z.object({
  type: z.enum(['FULL', 'DROP_IN']).optional(),
  // Required for a DROP_IN: the session(s) they're booking. sessionId is the
  // original single form, still accepted; sessionIds books several sessions of
  // the same class in one go — one enrolment, and one charge line, each.
  sessionId: z.string().min(1).optional(),
  sessionIds: z.array(z.string().min(1)).min(1).max(52).optional(),
  dogId: z.string().min(1).nullable().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — enrolment disabled' }, { status: 403 })

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true, trainerId: true, dogId: true, dogs: { select: { id: true } },
      // Names + trainer routing for the "client booked" notification.
      user: { select: { name: true } },
      dog: { select: { name: true } },
      trainer: { select: { businessName: true, user: { select: { id: true } } } },
      assignedTrainer: { select: { user: { select: { id: true } } } },
    },
  })
  if (!profile) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerUserId = profile.assignedTrainer?.user?.id ?? profile.trainer?.user?.id ?? null

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
  // A drop-in is one specific, still-to-come session. Resolve + validate it up
  // front so pricing, the capacity check and (for pay-to-confirm) the checkout
  // intent all point at the same session.
  type Slot = { capacity: number | null; priceCents: number | null; specialPriceCents: number | null } | null
  // The sessions being booked, each with the schedule slot behind it — the slot
  // sets that session's own price and capacity, so a class can charge and cap
  // differently on different days.
  let dropIns: { id: string; scheduledAt: Date; slot: Slot }[] = []
  if (type === 'DROP_IN') {
    if (!run.package.allowDropIn) {
      return NextResponse.json({ error: 'This class doesn’t allow drop-ins.' }, { status: 400 })
    }
    const wanted = parsed.data.sessionIds ?? (parsed.data.sessionId ? [parsed.data.sessionId] : [])
    if (wanted.length === 0) {
      return NextResponse.json({ error: 'Pick which session to drop into.' }, { status: 400 })
    }
    const found = await prisma.trainingSession.findMany({
      where: { id: { in: wanted }, classRunId: runId, status: 'UPCOMING', scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, scheduledAt: true,
        packageSessionSlot: { select: { capacity: true, priceCents: true, specialPriceCents: true } },
      },
    })
    // All or nothing on validity: a session that's gone means the list they
    // were shown is stale, and half-booking it silently is worse than asking
    // them to look again.
    if (found.length !== new Set(wanted).size) {
      return NextResponse.json({ error: 'One of those sessions has already happened or isn’t part of this class.' }, { status: 400 })
    }
    dropIns = found.map(s => ({ id: s.id, scheduledAt: s.scheduledAt, slot: s.packageSessionSlot }))
  }
  // The first chosen session drives the single-session decisions below.
  const dropInSessionId: string | null = dropIns[0]?.id ?? null
  const dropInSlot: Slot = dropIns[0]?.slot ?? null

  // Default to the client's primary dog; only honour a supplied dog they own.
  const ownDogIds = new Set([profile.dogId, ...profile.dogs.map(d => d.id)].filter(Boolean) as string[])
  const dogId = parsed.data.dogId ?? profile.dogId
  if (parsed.data.dogId && !ownDogIds.has(parsed.data.dogId)) {
    return NextResponse.json({ error: 'That dog isn’t on your account.' }, { status: 400 })
  }

  // Already booked? A FULL seat is one per client+dog for the whole run; a
  // drop-in is per session, so only the sessions they already hold clash —
  // booking two more Saturdays is a normal thing to do.
  const mine = { classRunId: runId, clientId: profile.id, dogId: dogId ?? null }
  if (type === 'FULL') {
    const existing = await prisma.classEnrollment.findFirst({
      where: { ...mine, status: { not: 'WITHDRAWN' } },
      select: { status: true },
    })
    if (existing) {
      return NextResponse.json({ error: 'You’re already enrolled in this class.' }, { status: 409 })
    }
  } else {
    const clashes = await prisma.classEnrollment.findMany({
      where: { ...mine, status: { not: 'WITHDRAWN' }, dropInSessionId: { in: dropIns.map(d => d.id) } },
      select: { dropInSessionId: true },
    })
    if (clashes.length > 0) {
      return NextResponse.json({ error: 'You’ve already booked one of those sessions.' }, { status: 409 })
    }
    // A full seat already covers every session — dropping in as well would
    // charge them twice for a class they're in.
    const full = await prisma.classEnrollment.findFirst({
      where: { ...mine, status: { not: 'WITHDRAWN' }, dropInSessionId: null },
      select: { id: true },
    })
    if (full) {
      return NextResponse.json({ error: 'You’re already enrolled in this class.' }, { status: 409 })
    }
  }

  // Price the enrolment. A drop-in is the price of the ONE session they picked
  // — its slot's, so a class can charge differently on different days; a full
  // seat is the whole-course price.
  // Each chosen session is priced on its own slot, so several sessions is the
  // sum of what each one costs — not one price times a quantity.
  const perSession = dropIns.map(d => ({ ...d, price: sessionDropInPriceCents(d.slot, run.package) }))
  const price: number | null =
    type === 'FULL'
      ? (run.package.specialPriceCents ?? run.package.priceCents)
      : perSession.reduce<number | null>((sum, s) => s.price == null ? sum : (sum ?? 0) + s.price, null)

  // Pay-to-confirm only when there's a real seat to pay for. Capacity is
  // per-session: each drop-in is checked against its own session (and that
  // session's own cap, if its slot sets one); a full seat checks the run.
  const decisions = await Promise.all(perSession.map(async s => ({
    ...s,
    decision: decideEnrollment({
      capacity: sessionCapacity(s.slot, run.capacity, run.package.capacity),
      enrolledCount: await sessionAttendeeCount(runId, s.id),
      allowWaitlist: run.package.allowWaitlist,
    }),
  })))
  // All or nothing again: charging for three sessions and seating them in two
  // is the worst outcome here, so a full session sends them back to choose.
  const rejected = decisions.filter(d => d.decision === 'REJECTED_FULL')
  if (type === 'DROP_IN' && rejected.length > 0) {
    return NextResponse.json({
      error: rejected.length === decisions.length
        ? 'That session is full.'
        : `${rejected.length} of the sessions you picked are full — choose again.`,
    }, { status: 409 })
  }
  const seatDecision = type === 'DROP_IN'
    // Waitlisted only if every chosen session is; otherwise they're getting a
    // real seat and the paid path applies.
    ? (decisions.every(d => d.decision === 'WAITLISTED') ? 'WAITLISTED' : 'ENROLLED')
    : decideEnrollment({
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
      // Enrolment now only ever starts from the availability wizard, so land on
      // the client's Sessions timeline (where the new class shows) on success,
      // and back on the wizard if they cancel.
      const appUrl = env.NEXT_PUBLIC_APP_URL
      const successUrl = `${appUrl}/my-sessions?booked=1`
      const cancelUrl = `${appUrl}/my-availability?enrol=cancelled`
      const { url } = await createConnectCheckout({
        sandbox,
        trainerId: profile.trainerId,
        connectAccountId: trainer.connectAccountId,
        clientId: profile.id,
        currency: trainer.payoutCurrency ?? 'nzd',
        description: `${run.name}${type === 'DROP_IN' ? ` (drop-in · ${perSession.length} session${perSession.length === 1 ? '' : 's'})` : ''}`,
        // One line per session, each carrying its own intent — the connect
        // webhook fulfils class lines one at a time, so this fans out into an
        // enrolment per session once the payment lands. A single line with
        // quantity 3 would pay for three and seat them once.
        lines: type === 'DROP_IN'
          ? perSession.map(s => ({
              kind: 'CLASS_ENROLLMENT' as const,
              description: `${run.name} (drop-in · ${s.scheduledAt.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })})`,
              unitAmount: s.price ?? 0,
              quantity: 1,
              intent: { classRunId: runId, type, dogId: dogId ?? null, sessionId: s.id },
            }))
          : [
            {
              kind: 'CLASS_ENROLLMENT' as const,
              description: run.name,
              unitAmount: price,
              quantity: 1,
              intent: { classRunId: runId, type, dogId: dogId ?? null, sessionId: null },
            },
          ],
        successUrl,
        cancelUrl,
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
    // One enrolment per chosen session (a FULL seat is a single pass with no
    // session), each raising its own receivable on the pay-later path.
    const targets: (string | null)[] = type === 'DROP_IN' ? perSession.map(s => s.id) : [null]
    const results: { enrollmentId: string; status: 'ENROLLED' | 'WAITLISTED' }[] = []
    for (const sid of targets) {
      results.push(await enrollInRun({ classRunId: runId, clientId: profile.id, dogId: dogId ?? null, type, sessionId: sid, source: 'SELF_SERVE' }))
    }
    const result = results[0]
    if (payLater) {
      for (const r of results.filter(r => r.status === 'ENROLLED')) {
        await prisma.classEnrollment.update({ where: { id: r.enrollmentId }, data: { invoicedAt: new Date() } }).catch(() => {})
        await createInvoiceForAssignment({
          trainerId: profile.trainerId,
          clientId: profile.id,
          sourceType: 'CLASS_ENROLLMENT',
          classEnrollmentId: r.enrollmentId,
          // They get the enrolment confirmation below — two emails seconds
          // apart, both about the same booking, is worse than one.
          notifyClient: false,
        })
      }
    }
    // Tell the trainer their client just enrolled (or joined the waitlist).
    if (trainerUserId) {
      const detail = `${run.name}${type === 'DROP_IN' ? ` (drop-in · ${results.length} session${results.length === 1 ? '' : 's'})` : ''}${result.status === 'WAITLISTED' ? ' (waitlist)' : ''}`
      await notifyTrainer(
        trainerUserId,
        'CLIENT_BOOKED_SESSION',
        { clientName: profile.user?.name ?? 'A client', dogName: profile.dog?.name ?? '', detail },
        `/classes/${runId}`,
        profile.trainerId,
      )
    }
    // Confirm to the client (in-app + email per their prefs) — a real seat only,
    // not a waitlist spot.
    if (result.status === 'ENROLLED') {
      await notifyClient({
        userId: active.userId,
        trainerId: profile.trainerId,
        type: 'CLIENT_ADDED_TO_PLAN',
        vars: {
          trainerName: profile.trainer?.businessName ?? 'Your trainer',
          dogName: profile.dog?.name ?? '',
          planName: run.name,
          // One confirmation for the lot, saying how many they booked.
          detail: type === 'DROP_IN' ? `Drop-in · ${results.length} session${results.length === 1 ? '' : 's'}` : '',
        },
        link: '/my-sessions',
        ctaLabel: 'View your sessions',
      }).catch(err => console.error('[class enrol] client-confirm failed', err))
    }
    return NextResponse.json({ ok: true, mode: result.status === 'WAITLISTED' ? 'waitlisted' : 'enrolled', booked: results.length }, { status: 201 })
  } catch (err) {
    if (err instanceof ClassError) {
      const status = err.code === 'FULL' || err.code === 'ALREADY_ENROLLED' || err.code === 'RUN_CLOSED' ? 409 : 400
      return NextResponse.json({ error: err.message }, { status })
    }
    throw err
  }
}
