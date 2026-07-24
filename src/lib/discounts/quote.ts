// Server-side discount application for a booking. Loads an offering's active
// discounts (package-scoped + trainer-wide), evaluates them for the booking,
// and scales the checkout line amounts to the discounted net — so the app fee
// (computed from the line totals) and the charge stay correct without touching
// connect-checkout or the webhook.
import { prisma } from '@/lib/prisma'
import { evaluateBooking, type DiscountRule, type DiscountCtx, type DiscountLine } from './evaluate'

type DiscountRow = {
  id: string; name: string; formText: string | null; isActive: boolean
  validFrom: Date | null; expiresAt: Date | null
  modifierType: 'PERCENT' | 'FLAT' | 'REPLACE'; modifierValue: number; applyTo: string
  conditions: unknown
}

function toRule(r: DiscountRow): DiscountRule {
  return {
    id: r.id, name: r.name, formText: r.formText, isActive: r.isActive,
    validFrom: r.validFrom, expiresAt: r.expiresAt,
    modifierType: r.modifierType, modifierValue: r.modifierValue,
    applyTo: r.applyTo as DiscountRule['applyTo'],
    conditions: Array.isArray(r.conditions) ? (r.conditions as DiscountRule['conditions']) : [],
  }
}

/** Active discounts that apply to an offering: its own + this trainer's trainer-wide. */
export async function loadOfferingDiscounts(trainerId: string, packageId: string | null): Promise<DiscountRule[]> {
  const rows = await prisma.discount.findMany({
    where: { trainerId, isActive: true, OR: [{ packageId: packageId ?? undefined }, { packageId: null }] },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(r => toRule(r as unknown as DiscountRow))
}

/**
 * Build one evaluator context per dog. In this flow every dog books the same
 * sessions, so the subjects are identical apart from sharing the group size.
 * fullDay/fullWeek are left false here — day-part completeness needs the
 * offering's slot layout and is a follow-up; the discount simply won't apply
 * rather than mis-charge.
 */
export function dogSubjects(args: { dogCount: number; perDogAmounts: number[]; dates: string[] }): DiscountCtx[] {
  const { dogCount, perDogAmounts, dates } = args
  const personTotal = perDogAmounts.reduce((s, a) => s + a, 0)
  const base: DiscountCtx = {
    personCount: dogCount,
    personTotal,
    positiveAmounts: perDogAmounts,
    selectedItemCount: perDogAmounts.length,
    dayCount: new Set(dates.map(d => d.slice(0, 10))).size,
    fullDay: false,
    fullWeek: false,
    age: null,
    selectedItemDates: dates,
  }
  return Array.from({ length: Math.max(1, dogCount) }, () => ({ ...base }))
}

/**
 * Distribute a discount across line amounts so the scaled lines sum EXACTLY to
 * gross − discount (integer cents). Proportional, with the rounding remainder
 * handed to the largest-fractional lines. Never returns a negative line.
 */
export function scaleLinesToNet(unitAmounts: number[], discountTotal: number): number[] {
  const gross = unitAmounts.reduce((s, a) => s + a, 0)
  if (gross <= 0 || discountTotal <= 0) return [...unitAmounts]
  const net = Math.max(0, gross - Math.round(discountTotal))
  const raw = unitAmounts.map(a => (a / gross) * net)
  const floored = raw.map(x => Math.floor(x))
  let remainder = net - floored.reduce((s, x) => s + x, 0)
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac)
  const out = [...floored]
  for (let k = 0; remainder > 0 && order.length; k++, remainder--) out[order[k % order.length].i]++
  return out
}

export interface DiscountQuote { discountTotal: number; lines: DiscountLine[] }

/** Quote the discount for a booking of `dogCount` dogs each paying `perDogAmounts`. */
export async function quoteOfferingDiscount(args: {
  trainerId: string
  packageId: string | null
  dogCount: number
  perDogAmounts: number[]
  dates: string[]
  oneOnly?: boolean
  now?: Date
}): Promise<DiscountQuote> {
  const rules = await loadOfferingDiscounts(args.trainerId, args.packageId)
  if (rules.length === 0) return { discountTotal: 0, lines: [] }
  const subjects = dogSubjects({ dogCount: args.dogCount, perDogAmounts: args.perDogAmounts, dates: args.dates })
  const { lines, total } = evaluateBooking(rules, subjects, { oneOnly: args.oneOnly ?? true, now: args.now })
  return { discountTotal: Math.round(total), lines }
}
