import { prisma } from '@/lib/prisma'
import {
  effectiveCapacity, enrolledCount, normalizeTicketQuantity,
  sessionAttendeeCount, sessionCapacity, sessionDropInPriceCents, wholeRunPriceCents,
} from '@/lib/class-runs'
import { offeringVisibleRelationWhere } from '@/lib/offering-visibility'

/**
 * Quote ONE class line of a basket: is it still bookable, and what does it cost?
 *
 * This is not a second pricing model. Every figure here comes from the same two
 * helpers the single-item enrol route and the trainer's own invoice read —
 * `wholeRunPriceCents` and `sessionDropInPriceCents` in class-runs.ts — because
 * a casual class has already been billed two different amounts by two callers
 * once (a six-week course invoiced at £180 and charged £30), and a basket that
 * derived its own number would be the third. What lives here is the CHECKING:
 * seats, sessions, dogs, tiers, all re-read at the moment of payment rather
 * than trusted from whenever the client tapped "add".
 *
 * Returns a refusal with a sentence a client can act on, never a silent drop.
 */

export interface ClassLineRequest {
  classRunId: string
  type: 'FULL' | 'DROP_IN'
  /** Chosen sessions for a DROP_IN; ignored for a FULL seat. */
  sessionIds: string[]
  /** One entry per dog. A single null = booked without naming a dog. */
  dogIds: (string | null)[]
  ticketTierId: string | null
  /** Ticket count for a ticketed event. 1 everywhere else. */
  quantity: number
}

/** A checkout line, in exactly the shape the connect webhook fulfils from. */
export interface QuotedClassLine {
  kind: 'CLASS_ENROLLMENT'
  description: string
  unitAmount: number
  quantity: number
  intent: { classRunId: string; type: 'FULL' | 'DROP_IN'; dogId: string | null; sessionId: string | null }
}

export interface ClassQuote {
  classRunId: string
  packageId: string
  runName: string
  /** Everything the discount engine needs, quoted per RUN (see basket route). */
  dogCount: number
  perDogAmounts: number[]
  dates: string[]
  lines: QuotedClassLine[]
  grossTotal: number
}

export type ClassQuoteResult =
  | { ok: true; quote: ClassQuote }
  | { ok: false; reason: string }

const fmtDay = (d: Date) => d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })

export async function quoteClassLine(args: {
  trainerId: string
  clientId: string
  /** Dogs this client actually owns — a dog id from anyone else is refused. */
  ownDogIds: Set<string>
  deceasedDogIds: Set<string>
  line: ClassLineRequest
  now?: Date
}): Promise<ClassQuoteResult> {
  const { trainerId, clientId, line } = args
  const now = args.now ?? new Date()

  const run = await prisma.classRun.findFirst({
    // A basket line is a second, independent way into an offering — gate it
    // exactly as the enrol route does, or a scheduled offering is buyable
    // through checkout while invisible everywhere else.
    where: { id: line.classRunId, trainerId, ...offeringVisibleRelationWhere(now) },
    // The tiers come along because on a ticketed event THEY are the price — the
    // package's own priceCents is whatever was typed before tiers existed.
    include: { package: { include: { ticketTiers: { orderBy: { order: 'asc' } } } } },
  })
  if (!run || !run.package.isGroup) return { ok: false, reason: 'That class is no longer available.' }
  if (run.status === 'CANCELLED' || run.status === 'COMPLETED') {
    return { ok: false, reason: `${run.name} is no longer taking enrolments.` }
  }

  // ── Ticketed events ────────────────────────────────────────────────────────
  const tiers = run.package.ticketTiers
  const ticketed = tiers.length > 0
  let tier: (typeof tiers)[number] | null = null
  let ticketQuantity = 1
  if (ticketed) {
    if (line.type !== 'FULL') return { ok: false, reason: `${run.name} sells tickets — there’s no drop-in rate.` }
    if (!line.ticketTierId) return { ok: false, reason: `Pick a ticket type for ${run.name}.` }
    tier = tiers.find(t => t.id === line.ticketTierId) ?? null
    if (!tier) return { ok: false, reason: `That ticket type isn’t part of ${run.name} any more.` }
    ticketQuantity = normalizeTicketQuantity(line.quantity)
    if (tier.capacity != null) {
      const sold = await prisma.classEnrollment.aggregate({
        where: { classRunId: run.id, ticketTierId: tier.id, status: 'ENROLLED' },
        _sum: { quantity: true },
      })
      const left = Math.max(0, tier.capacity - (sold._sum?.quantity ?? 0))
      if (ticketQuantity > left) {
        return {
          ok: false,
          reason: left === 0
            ? `${tier.name} tickets for ${run.name} sold out.`
            : `Only ${left} ${tier.name} ticket${left === 1 ? '' : 's'} left for ${run.name}.`,
        }
      }
    }
  }

  // ── The sessions a drop-in is for ──────────────────────────────────────────
  type Slot = { capacity: number | null; priceCents: number | null; specialPriceCents: number | null } | null
  let dropIns: { id: string; scheduledAt: Date; slot: Slot }[] = []
  if (line.type === 'DROP_IN') {
    if (!run.package.allowDropIn) return { ok: false, reason: `${run.name} doesn’t allow drop-ins.` }
    const wanted = [...new Set(line.sessionIds)]
    if (wanted.length === 0) return { ok: false, reason: `Pick which ${run.name} sessions to drop into.` }
    const found = await prisma.trainingSession.findMany({
      where: { id: { in: wanted }, classRunId: run.id, status: 'UPCOMING', scheduledAt: { gte: now } },
      orderBy: { scheduledAt: 'asc' },
      select: {
        id: true, scheduledAt: true,
        packageSessionSlot: { select: { capacity: true, priceCents: true, specialPriceCents: true } },
      },
    })
    // The commonest way a basket goes stale: it sat there until a session ran.
    if (found.length !== wanted.length) {
      return { ok: false, reason: `One of your ${run.name} sessions has already been — it left your basket.` }
    }
    dropIns = found.map(s => ({ id: s.id, scheduledAt: s.scheduledAt, slot: s.packageSessionSlot }))
  }

  // ── Dogs ───────────────────────────────────────────────────────────────────
  const dogs: (string | null)[] = line.dogIds.length ? [...new Set(line.dogIds)] : [null]
  for (const d of dogs) {
    if (d && !args.ownDogIds.has(d)) return { ok: false, reason: 'That dog isn’t on your account.' }
    if (d && args.deceasedDogIds.has(d)) {
      return { ok: false, reason: 'That dog is marked as deceased and can’t be enrolled.' }
    }
  }
  const dogCount = dogs.length
  const nonNullDogs = dogs.filter((d): d is string => !!d)
  const dogWhere = nonNullDogs.length > 0 ? { dogId: { in: nonNullDogs } } : { dogId: null }
  const mine = { classRunId: run.id, clientId, ...dogWhere }

  // Already holding the place — including from another tab, or from the
  // single-item flow while this basket sat open.
  if (line.type === 'FULL') {
    const existing = await prisma.classEnrollment.findFirst({
      where: { ...mine, status: { not: 'WITHDRAWN' } }, select: { id: true },
    })
    if (existing) {
      return { ok: false, reason: dogCount > 1 ? `One of those dogs is already in ${run.name}.` : `You’re already enrolled in ${run.name}.` }
    }
  } else {
    const clash = await prisma.classEnrollment.findFirst({
      where: { ...mine, status: { not: 'WITHDRAWN' }, dropInSessionId: { in: dropIns.map(d => d.id) } },
      select: { id: true },
    })
    if (clash) return { ok: false, reason: `One of those ${run.name} sessions is already booked.` }
    const full = await prisma.classEnrollment.findFirst({
      where: { ...mine, status: { not: 'WITHDRAWN' }, dropInSessionId: null }, select: { id: true },
    })
    if (full) return { ok: false, reason: `You’re already enrolled in ${run.name}.` }
  }

  // ── Price ──────────────────────────────────────────────────────────────────
  // Same rule, same helpers, as the single-item enrol route: a casual class has
  // no course price, so a full seat is the sum of the RUN's sessions.
  const fullSeatCents = run.package.allowDropIn
    ? (await wholeRunPriceCents(run.id, run.package)) ?? run.package.specialPriceCents ?? run.package.priceCents
    : (run.package.specialPriceCents ?? run.package.priceCents ?? await wholeRunPriceCents(run.id, run.package))
  const perSession = dropIns.map(d => ({ ...d, price: sessionDropInPriceCents(d.slot, run.package) }))
  const perDogPrice: number | null =
    line.type === 'FULL'
      ? (ticketed && tier ? tier.priceCents : fullSeatCents)
      : perSession.reduce<number | null>((sum, s) => (s.price == null ? sum : (sum ?? 0) + s.price), null)

  const grossTotal = ticketed
    ? (perDogPrice ?? 0) * ticketQuantity
    : (perDogPrice ?? 0) * dogCount
  if (grossTotal <= 0) {
    // A free class can't be part of a card payment — Stripe has nothing to
    // charge. Saying so beats a checkout that quietly bills the rest.
    return { ok: false, reason: `${run.name} is free — join it straight from the booking screen.` }
  }

  // ── Seats ──────────────────────────────────────────────────────────────────
  // A basket NEVER waitlists. The single-item flow can offer a waitlist place
  // because the client is looking at that one class and can be told; inside a
  // basket it would mean taking their card for a place they may not get, mixed
  // in with a harness they definitely do. Refuse, and let them re-add it from
  // the class screen where the waitlist is offered properly.
  const fits = (capacity: number | null, taken: number) => (capacity == null ? true : capacity - taken >= dogCount)
  if (line.type === 'DROP_IN') {
    for (const s of perSession) {
      const cap = sessionCapacity(s.slot, run.capacity, run.package.capacity)
      if (!fits(cap, await sessionAttendeeCount(run.id, s.id))) {
        return {
          ok: false,
          reason: `${run.name} on ${fmtDay(s.scheduledAt)} ${dogCount > 1 ? 'can’t take that many dogs' : 'filled up'} — it left your basket.`,
        }
      }
    }
  } else if (!ticketed) {
    if (!fits(effectiveCapacity(run.capacity, run.package.capacity), await enrolledCount(run.id))) {
      return { ok: false, reason: `${run.name} filled up — it left your basket.` }
    }
  }

  // ── Lines ──────────────────────────────────────────────────────────────────
  // One line per dog × session, each carrying its own intent, because the
  // webhook fulfils class lines one at a time. A TICKETED event is the
  // exception: one line for the tickets bought, never fanned out per dog, or
  // two dogs would double the charge for one ticket.
  const lines: QuotedClassLine[] = ticketed && tier
    ? [{
        kind: 'CLASS_ENROLLMENT',
        description: `${run.name} (${tier.name}${ticketQuantity > 1 ? ` × ${ticketQuantity}` : ''})`,
        unitAmount: tier.priceCents ?? 0,
        quantity: ticketQuantity,
        intent: { classRunId: run.id, type: 'FULL', dogId: dogs[0] ?? null, sessionId: null },
      }]
    : dogs.flatMap((dog): QuotedClassLine[] =>
        line.type === 'DROP_IN'
          ? perSession.map(s => ({
              kind: 'CLASS_ENROLLMENT' as const,
              description: `${run.name} (drop-in · ${fmtDay(s.scheduledAt)})`,
              unitAmount: s.price ?? 0,
              quantity: 1,
              intent: { classRunId: run.id, type: line.type, dogId: dog ?? null, sessionId: s.id },
            }))
          : [{
              kind: 'CLASS_ENROLLMENT' as const,
              description: run.name,
              unitAmount: perDogPrice ?? 0,
              quantity: 1,
              intent: { classRunId: run.id, type: line.type, dogId: dog ?? null, sessionId: null },
            }],
      )

  return {
    ok: true,
    quote: {
      classRunId: run.id,
      packageId: run.packageId,
      runName: run.name,
      dogCount,
      perDogAmounts: line.type === 'DROP_IN' ? perSession.map(s => s.price ?? 0) : [perDogPrice ?? 0],
      dates: perSession.map(s => s.scheduledAt.toISOString()),
      lines,
      grossTotal,
    },
  }
}
