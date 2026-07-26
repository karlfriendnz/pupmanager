import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import {
  enrollInRun, ClassError, effectiveCapacity, enrolledCount,
  sessionAttendeeCount, sessionDropInPriceCents, sessionCapacity,
  normalizeTicketQuantity, MAX_TICKET_QUANTITY,
} from '@/lib/class-runs'
import { createConnectCheckout } from '@/lib/connect-checkout'
import { isConnectConfigured } from '@/lib/connect'
import { createInvoiceForAssignment } from '@/lib/invoicing'
import { resolveRequirePayment } from '@/lib/require-payment'
import { enforceRateLimit } from '@/lib/rate-limit'
import { notifyTrainer } from '@/lib/trainer-notify'
import { notifyClient } from '@/lib/client-notify'
import { quoteOfferingDiscount, scaleLinesToNet } from '@/lib/discounts/quote'
import { env } from '@/lib/env'

// Client self-enrolment into a group class run. Free classes (or trainers not
// taking payments) enrol straight away; a priced class with payments on is
// pay-to-confirm — the connect webhook enrols on success. Supports booking
// several dogs at once (dogIds) and applies the offering's discounts to the
// charge.
//
// EVENTS THAT SELL TICKETS are the exception, and the reason this route can't
// just read the package price. An event's offering can carry several named
// ticket types at their own prices ("General $200 / Concession $123 / Child
// $89"); the package's own priceCents is then meaningless — it's whatever was
// typed into the offering before the tiers were added. This route used to bill
// that number, so a client self-booking a $200 ticket was charged the package's
// $45. The rule now: if the offering has ANY ticket tier, the booking MUST name
// one, and the price is read from that tier row server-side. No tier named →
// 400, never a fallback to the package price. Blocking beats undercharging.

const schema = z.object({
  type: z.enum(['FULL', 'DROP_IN']).optional(),
  // Required for a DROP_IN: the session(s) they're booking. sessionId is the
  // original single form, still accepted; sessionIds books several sessions of
  // the same class in one go — one enrolment, and one charge line, each.
  sessionId: z.string().min(1).optional(),
  sessionIds: z.array(z.string().min(1)).min(1).max(52).optional(),
  dogId: z.string().min(1).nullable().optional(),
  // Book several dogs in one go — each dog becomes its own enrolment (and its
  // own charge line) per chosen session. Falls back to the single dogId.
  dogIds: z.array(z.string().min(1)).min(1).max(20).optional(),
  // Which ticket type they're buying, and how many. Required when the event
  // sells tickets; ignored (and forced null) when it doesn't. The id is only
  // ever resolved against THIS run's own offering — a tier id from another
  // event, or another trainer, resolves to nothing and is refused.
  ticketTierId: z.string().min(1).nullable().optional(),
  quantity: z.number().int().min(1).max(MAX_TICKET_QUANTITY).optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const active = await getActiveClient()
  if (!active) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (active.isPreview) return NextResponse.json({ error: 'Preview mode — enrolment disabled' }, { status: 403 })

  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: {
      id: true, trainerId: true, dogId: true, dogs: { select: { id: true } },
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
    // The offering's ticket tiers come along because they, not the package's
    // price, are what a ticketed event costs.
    include: { package: { include: { ticketTiers: { orderBy: { order: 'asc' } } } } },
  })
  if (!run || !run.package.isGroup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (run.status === 'CANCELLED' || run.status === 'COMPLETED') {
    return NextResponse.json({ error: 'This class is no longer taking enrolments.' }, { status: 409 })
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  const type = parsed.data.type ?? 'FULL'

  // ── Ticketed events ────────────────────────────────────────────────────────
  // An offering with tiers sells by the ticket, and the tier row is the ONLY
  // source of its price. Everything below reads `tier`/`ticketQuantity` rather
  // than the package price when `ticketed` is true.
  const tiers = run.package.ticketTiers
  const ticketed = tiers.length > 0
  let tier: (typeof tiers)[number] | null = null
  let ticketQuantity = 1
  if (ticketed) {
    if (type !== 'FULL') {
      return NextResponse.json({ error: 'This event sells tickets — there’s no drop-in rate.' }, { status: 400 })
    }
    if (!parsed.data.ticketTierId) {
      return NextResponse.json({ error: 'Pick a ticket type.' }, { status: 400 })
    }
    tier = tiers.find(t => t.id === parsed.data.ticketTierId) ?? null
    if (!tier) {
      return NextResponse.json({ error: 'That ticket type isn’t part of this event.' }, { status: 400 })
    }
    ticketQuantity = normalizeTicketQuantity(parsed.data.quantity ?? 1)

    // A ticket type caps itself independently of the event's capacity, so it's
    // checked before we take any money. enrollInRun re-checks it inside its own
    // transaction (that's the authoritative one) — this is here so a sold-out
    // tier is refused at the quote instead of after a successful charge.
    if (tier.capacity != null) {
      const sold = await prisma.classEnrollment.aggregate({
        where: { classRunId: runId, ticketTierId: tier.id, status: 'ENROLLED' },
        _sum: { quantity: true },
      })
      const left = Math.max(0, tier.capacity - (sold._sum?.quantity ?? 0))
      if (ticketQuantity > left) {
        return NextResponse.json({
          error: left === 0
            ? `${tier.name} tickets are sold out.`
            : `Only ${left} ${tier.name} ticket${left === 1 ? '' : 's'} left.`,
        }, { status: 409 })
      }
    }
  }

  type Slot = { capacity: number | null; priceCents: number | null; specialPriceCents: number | null } | null
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
    if (found.length !== new Set(wanted).size) {
      return NextResponse.json({ error: 'One of those sessions has already happened or isn’t part of this class.' }, { status: 400 })
    }
    dropIns = found.map(s => ({ id: s.id, scheduledAt: s.scheduledAt, slot: s.packageSessionSlot }))
  }

  // One or more dogs. Multi-dog uses dogIds; the single-dog path (dogId /
  // primary) is unchanged, so an existing single-dog booking behaves exactly as
  // before (dogs = [that one dog], dogCount = 1).
  const ownDogIds = new Set([profile.dogId, ...profile.dogs.map(d => d.id)].filter(Boolean) as string[])
  const dogs: (string | null)[] = parsed.data.dogIds
    ? [...new Set(parsed.data.dogIds)]
    : [parsed.data.dogId ?? profile.dogId ?? null]
  for (const d of dogs) {
    if (d && !ownDogIds.has(d)) return NextResponse.json({ error: 'That dog isn’t on your account.' }, { status: 400 })
  }
  const dogCount = dogs.length
  // For the "already booked?" queries: match the real dog ids, or the null-dog
  // row when the client is booking without a specific dog.
  const nonNullDogs = dogs.filter((d): d is string => !!d)
  const dogWhere = nonNullDogs.length > 0 ? { dogId: { in: nonNullDogs } } : { dogId: null }
  const mine = { classRunId: runId, clientId: profile.id, ...dogWhere }

  if (type === 'FULL') {
    const existing = await prisma.classEnrollment.findFirst({
      where: { ...mine, status: { not: 'WITHDRAWN' } },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json({ error: dogCount > 1 ? 'One of those dogs is already enrolled in this class.' : 'You’re already enrolled in this class.' }, { status: 409 })
    }
  } else {
    const clashes = await prisma.classEnrollment.findMany({
      where: { ...mine, status: { not: 'WITHDRAWN' }, dropInSessionId: { in: dropIns.map(d => d.id) } },
      select: { id: true },
    })
    if (clashes.length > 0) {
      return NextResponse.json({ error: 'One of those dogs already has one of those sessions booked.' }, { status: 409 })
    }
    const full = await prisma.classEnrollment.findFirst({
      where: { ...mine, status: { not: 'WITHDRAWN' }, dropInSessionId: null },
      select: { id: true },
    })
    if (full) {
      return NextResponse.json({ error: 'You’re already enrolled in this class.' }, { status: 409 })
    }
  }

  // Price per dog. A drop-in is the sum of its chosen sessions' slot prices; a
  // full seat is the whole-course price. The booking total is this × dogCount.
  const perSession = dropIns.map(d => ({ ...d, price: sessionDropInPriceCents(d.slot, run.package) }))
  const perDogPrice: number | null =
    type === 'FULL'
      // A ticketed event is priced by the ticket, full stop. The package's own
      // priceCents is meaningless there (it's whatever was typed before tiers
      // existed) and reading it is exactly how a $200 ticket got sold for $45.
      ? (ticketed && tier ? tier.priceCents : (run.package.specialPriceCents ?? run.package.priceCents))
      : perSession.reduce<number | null>((sum, s) => s.price == null ? sum : (sum ?? 0) + s.price, null)

  // Capacity is per-session and must seat EVERY dog being booked. seatsFor gives
  // how many still fit; a session that can't take all the dogs blocks the lot
  // (or waitlists it, if the class allows a waitlist).
  const seatsFor = (capacity: number | null, enrolled: number) => (capacity == null ? Infinity : Math.max(0, capacity - enrolled))
  const decisions = await Promise.all(perSession.map(async s => {
    const seats = seatsFor(sessionCapacity(s.slot, run.capacity, run.package.capacity), await sessionAttendeeCount(runId, s.id))
    return { ...s, fits: seats >= dogCount }
  }))
  const rejected = decisions.filter(d => !d.fits && !run.package.allowWaitlist)
  if (type === 'DROP_IN' && rejected.length > 0) {
    return NextResponse.json({
      error: rejected.length === decisions.length
        ? (dogCount > 1 ? 'That session can’t take that many dogs.' : 'That session is full.')
        : `${rejected.length} of the sessions you picked can’t take ${dogCount > 1 ? 'that many dogs' : 'another booking'} — choose again.`,
    }, { status: 409 })
  }

  let seatDecision: 'ENROLLED' | 'WAITLISTED' | 'REJECTED_FULL'
  if (type === 'DROP_IN') {
    seatDecision = decisions.every(d => d.fits) ? 'ENROLLED' : 'WAITLISTED'
  } else {
    const seats = seatsFor(effectiveCapacity(run.capacity, run.package.capacity), await enrolledCount(runId))
    seatDecision = seats >= dogCount ? 'ENROLLED' : run.package.allowWaitlist ? 'WAITLISTED' : 'REJECTED_FULL'
  }

  // Discount the offering's rules give this booking (0 when none apply). Reduces
  // the charge only — a booking with no configured discounts is unchanged.
  const perDogAmounts = type === 'DROP_IN' ? perSession.map(s => s.price ?? 0) : [perDogPrice ?? 0]
  const dates = perSession.map(s => s.scheduledAt.toISOString())
  // Tickets multiply by how many were bought, not by how many dogs came: a
  // ticket is a place at the event, and an owner can buy several.
  const grossTotal = ticketed ? (perDogPrice ?? 0) * ticketQuantity : (perDogPrice ?? 0) * dogCount
  const { discountTotal } = grossTotal > 0
    ? await quoteOfferingDiscount({ trainerId: profile.trainerId, packageId: run.packageId, dogCount, perDogAmounts, dates })
    : { discountTotal: 0 }

  // Pay-to-confirm only when there's a real seat to pay for.
  let payLater = false
  if (grossTotal > 0 && seatDecision === 'ENROLLED') {
    const trainer = await prisma.trainerProfile.findUnique({
      where: { id: profile.trainerId },
      select: { acceptPaymentsEnabled: true, connectChargesEnabled: true, connectAccountId: true, payoutCurrency: true, sandboxBilling: true, defaultRequirePayment: true },
    })
    if (!trainer?.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
      return NextResponse.json({ error: 'This class needs payment, which isn’t switched on yet.' }, { status: 409 })
    }
    if (!resolveRequirePayment(run.requirePayment, trainer.defaultRequirePayment)) {
      payLater = true
    }
    const sandbox = trainer.sandboxBilling
    if (!payLater && !isConnectConfigured(sandbox)) {
      return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
    }
    if (!payLater) {
      const appUrl = env.NEXT_PUBLIC_APP_URL
      const successUrl = `${appUrl}/my-sessions?booked=1`
      const cancelUrl = `${appUrl}/my-availability?enrol=cancelled`
      const fmtDay = (d: Date) => d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })

      // One line per dog × chosen session, each carrying its own intent — the
      // connect webhook fulfils class lines one at a time, so this fans out into
      // an enrolment per (dog, session) once the payment lands.
      type Line = { kind: 'CLASS_ENROLLMENT'; description: string; unitAmount: number; quantity: number; intent: { classRunId: string; type: 'FULL' | 'DROP_IN'; dogId: string | null; sessionId: string | null } }
      // A ticketed event bills ONE line for the tickets bought — it must not
      // fan out per dog, or two dogs would double the charge for one ticket.
      const grossLines: Line[] = ticketed && tier
        ? [{
            kind: 'CLASS_ENROLLMENT' as const,
            description: `${run.name} (${tier.name}${ticketQuantity > 1 ? ` × ${ticketQuantity}` : ''})`,
            // ?? 0 matches how a null package price is treated (free); it's the
            // same nullable Int. grossTotal above coerces identically, so the
            // line and the total can't disagree.
            unitAmount: tier.priceCents ?? 0,
            quantity: ticketQuantity,
            intent: { classRunId: runId, type: 'FULL', dogId: dogs[0] ?? null, sessionId: null },
          }]
        : dogs.flatMap((dog): Line[] =>
        type === 'DROP_IN'
          ? perSession.map(s => ({
              kind: 'CLASS_ENROLLMENT' as const,
              description: `${run.name} (drop-in · ${fmtDay(s.scheduledAt)})`,
              unitAmount: s.price ?? 0,
              quantity: 1,
              intent: { classRunId: runId, type, dogId: dog ?? null, sessionId: s.id },
            }))
          : [{
              kind: 'CLASS_ENROLLMENT' as const,
              description: run.name,
              unitAmount: perDogPrice ?? 0,
              quantity: 1,
              intent: { classRunId: runId, type, dogId: dog ?? null, sessionId: null },
            }],
      )
      // Spread the discount across the lines so the total charged (and the
      // platform fee, computed from the line totals) is the discounted net.
      const scaled = scaleLinesToNet(grossLines.map(l => l.unitAmount), discountTotal)
      const lines = grossLines.map((l, i) => ({ ...l, unitAmount: scaled[i] }))

      const bookedLabel = `${type === 'DROP_IN' ? `drop-in · ${perSession.length} session${perSession.length === 1 ? '' : 's'}` : 'full'}${dogCount > 1 ? ` · ${dogCount} dogs` : ''}`
      const { url } = await createConnectCheckout({
        sandbox,
        trainerId: profile.trainerId,
        connectAccountId: trainer.connectAccountId,
        clientId: profile.id,
        currency: trainer.payoutCurrency ?? 'nzd',
        description: `${run.name} (${bookedLabel})`,
        lines,
        successUrl,
        cancelUrl,
      })
      if (!url) return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
      return NextResponse.json({ ok: true, mode: 'payment', url }, { status: 201 })
    }
    // payLater: fall through to the enrolment below, then raise receivables.
  }

  if (grossTotal > 0 && seatDecision === 'REJECTED_FULL') {
    return NextResponse.json({ error: 'This class is full.' }, { status: 409 })
  }

  // Free (or waitlist) enrolment — straight in. A priced pay-later enrolment
  // (require-payment off) also lands here: we enrol, then raise a receivable.
  try {
    // One enrolment per dog × chosen session (a FULL seat is a single pass with
    // no session), each raising its own receivable on the pay-later path.
    const targets: (string | null)[] = type === 'DROP_IN' ? perSession.map(s => s.id) : [null]
    const results: { enrollmentId: string; status: 'ENROLLED' | 'WAITLISTED' }[] = []
    if (ticketed && tier) {
      // One enrolment carrying the tier and how many tickets — not one per dog.
      // The tier id is what the invoice prices from, so it must be recorded here
      // or the receivable falls back to the package price.
      results.push(await enrollInRun({
        classRunId: runId, clientId: profile.id, dogId: dogs[0] ?? null,
        type: 'FULL', sessionId: null, ticketTierId: tier.id, quantity: ticketQuantity,
        source: 'SELF_SERVE',
      }))
    } else {
      for (const dog of dogs) {
        for (const sid of targets) {
          results.push(await enrollInRun({ classRunId: runId, clientId: profile.id, dogId: dog ?? null, type, sessionId: sid, source: 'SELF_SERVE' }))
        }
      }
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
          notifyClient: false,
        })
      }
    }
    if (trainerUserId) {
      const dogsLabel = dogCount > 1 ? ` · ${dogCount} dogs` : ''
      const detail = `${run.name}${type === 'DROP_IN' ? ` (drop-in · ${perSession.length} session${perSession.length === 1 ? '' : 's'})` : ''}${dogsLabel}${result.status === 'WAITLISTED' ? ' (waitlist)' : ''}`
      await notifyTrainer(
        trainerUserId,
        'CLIENT_BOOKED_SESSION',
        { clientName: profile.user?.name ?? 'A client', dogName: profile.dog?.name ?? '', detail },
        `/classes/${runId}`,
        profile.trainerId,
      )
    }
    if (result.status === 'ENROLLED') {
      await notifyClient({
        userId: active.userId,
        trainerId: profile.trainerId,
        type: 'CLIENT_ADDED_TO_PLAN',
        vars: {
          trainerName: profile.trainer?.businessName ?? 'Your trainer',
          dogName: profile.dog?.name ?? '',
          planName: run.name,
          detail: `${type === 'DROP_IN' ? `Drop-in · ${perSession.length} session${perSession.length === 1 ? '' : 's'}` : ''}${dogCount > 1 ? `${type === 'DROP_IN' ? ' · ' : ''}${dogCount} dogs` : ''}`.trim(),
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
