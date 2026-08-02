// Quote an offering's discounts for a set of class enrolments that were booked
// as ONE action, and split the saving back across them.
//
// WHY THIS EXISTS: a client self-booking got the discount and a trainer booking
// the same client into the same days did not. The client route
// (api/my/classes/[runId]/enroll) has always called quoteOfferingDiscount before
// building the checkout; the trainer route (api/class-runs/[runId]/enrollments)
// raised its receivable straight off the package price. Same class, same client,
// same day — two different prices, and the trainer's own invoice was the wrong
// one. This module is the shared middle so there is still only ONE quoting
// function and ONE pricing function between them.
//
// The discount is quoted for the WHOLE basket in a single call on purpose. The
// rules are basket-shaped — "book 5 days, get one free", "second dog half
// price", "book a full week" — so evaluating one enrolment at a time would
// silently never fire them and quietly undercharge nobody but overcharge every
// client who booked in bulk.
import { prisma } from '@/lib/prisma'
import { priceClassEnrollment } from '@/lib/invoicing'
import { quoteOfferingDiscount, scaleLinesToNet } from './quote'

export interface EnrollmentDiscountQuote {
  /** Total saving across the whole booking, in cents. */
  discountTotal: number
  /** How much of that saving belongs to each enrolment id, in cents. */
  perEnrollment: Record<string, number>
}

const EMPTY: EnrollmentDiscountQuote = { discountTotal: 0, perEnrollment: {} }

/**
 * Quote the offering's discounts for enrolments booked together, and hand each
 * one its share of the saving.
 *
 * Returns zeros when the trainer has no discounts configured, when nothing in
 * the basket is priced, or when the enrolments can't be resolved — the caller
 * then raises exactly the invoice it always did.
 */
export async function quoteEnrollmentDiscounts(args: {
  trainerId: string
  clientId: string
  enrollmentIds: string[]
  now?: Date
}): Promise<EnrollmentDiscountQuote> {
  const ids = [...new Set(args.enrollmentIds.filter(Boolean))]
  if (ids.length === 0) return EMPTY

  const rows = await prisma.classEnrollment.findMany({
    // Tenant guard rides along: an enrolment on another company's run, or
    // another client's, never reaches the quote.
    where: { id: { in: ids }, clientId: args.clientId, classRun: { trainerId: args.trainerId } },
    orderBy: [{ enrolledAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      dogId: true,
      type: true,
      quantity: true,
      joinedAtIndex: true,
      ticketTier: { select: { name: true, priceCents: true } },
      dropInSession: {
        select: {
          scheduledAt: true,
          packageSessionSlot: { select: { priceCents: true, specialPriceCents: true } },
        },
      },
      classRun: {
        select: {
          id: true,
          name: true,
          packageId: true,
          package: {
            select: { priceCents: true, specialPriceCents: true, dropInPriceCents: true, allowDropIn: true },
          },
        },
      },
    },
  })
  if (rows.length === 0) return EMPTY

  // Priced through priceClassEnrollment — the SAME function the invoice prices
  // with — so the discount can never be calculated against a different number
  // from the one that gets billed.
  const priced = await Promise.all(
    rows.map(async r => ({ row: r, ...(await priceClassEnrollment(r)) })),
  )
  const gross = priced.map(p => p.amountCents ?? 0)
  const grossTotal = gross.reduce((s, a) => s + a, 0)
  if (grossTotal <= 0) return EMPTY

  // One dog's worth of the basket, and how many dogs are in it — the shape
  // quoteOfferingDiscount expects (it builds one evaluator subject per dog, each
  // holding that dog's own amounts). Every dog in a single booking takes the
  // same sessions, so the first dog's lines stand for all of them, exactly as
  // the client route's `perDogAmounts` / `dogCount` pair does.
  const dogKeys = [...new Set(priced.map(p => p.row.dogId ?? ''))]
  const firstDog = dogKeys[0]
  const oneDog = priced.filter(p => (p.row.dogId ?? '') === firstDog)

  // UNIT prices, not line totals — the client route feeds
  // quoteOfferingDiscount unit amounts too (a ticket's own price, a session's
  // own price), and matching it bug-for-bug is the whole point of this fix.
  const perDogAmounts = oneDog.map(p => p.unitAmountCents ?? 0)
  // Dated items let the day-count / "N within a period" rules fire. A FULL seat
  // isn't tied to one date, so it contributes none — same as the client route,
  // where `dates` only ever comes from the drop-in sessions chosen.
  const dates = oneDog
    .map(p => p.row.dropInSession?.scheduledAt)
    .filter((d): d is Date => !!d)
    .map(d => d.toISOString())

  const { discountTotal } = await quoteOfferingDiscount({
    trainerId: args.trainerId,
    packageId: rows[0].classRun.packageId,
    dogCount: dogKeys.length,
    perDogAmounts,
    dates,
    now: args.now,
  })
  if (discountTotal <= 0) return EMPTY

  // Spread the saving across the enrolments in proportion to what each costs,
  // with scaleLinesToNet — the same distribution the client's checkout lines
  // get — so the shares add back up to the quoted total exactly, to the cent.
  const net = scaleLinesToNet(gross, discountTotal)
  const perEnrollment: Record<string, number> = {}
  let allocated = 0
  priced.forEach((p, i) => {
    const share = gross[i] - net[i]
    perEnrollment[p.row.id] = share
    allocated += share
  })
  return { discountTotal: allocated, perEnrollment }
}
