import { describe, it, expect } from 'vitest'
import {
  discountAmount, applicableDiscounts, aggregateDiscountLines, evaluateBooking,
  type DiscountRule, type DiscountCtx,
} from '@/lib/discounts/evaluate'

// Validates the ported evaluator across modifier types, apply-to targets and
// conditions. All amounts in cents. `now` is passed so validity windows are
// deterministic.
const NOW = new Date('2026-08-01T00:00:00.000Z')

function ctx(over: Partial<DiscountCtx> = {}): DiscountCtx {
  return {
    personCount: 1, personTotal: 6900, positiveAmounts: [1800, 1800, 1800, 1500],
    selectedItemCount: 4, dayCount: 1, fullDay: false, fullWeek: false, age: null, ...over,
  }
}

describe('discountAmount — modifier types × apply-to', () => {
  it('whole-day REPLACE sets the order total (only when full day)', () => {
    const rule: DiscountRule = { name: 'Whole day', modifierType: 'REPLACE', modifierValue: 5500, applyTo: 'order_total', conditions: [{ key: 'booked_full_day' }] }
    expect(discountAmount(rule, ctx({ fullDay: true }), NOW)).toBe(6900 - 5500)
    expect(discountAmount(rule, ctx({ fullDay: false }), NOW)).toBe(0)
  })

  it('sibling PERCENT per-person applies only for 2+ subjects', () => {
    const rule: DiscountRule = { name: 'Second dog', modifierType: 'PERCENT', modifierValue: 25, applyTo: 'per_person', conditions: [{ key: 'group_size_min', operator: '>=', value: 2 }] }
    expect(discountAmount(rule, ctx({ personCount: 2 }), NOW)).toBe(6900 * 0.25)
    expect(discountAmount(rule, ctx({ personCount: 1 }), NOW)).toBe(0)
  })

  it('early-bird FLAT off the order total, gated on a before-date', () => {
    const rule: DiscountRule = { name: 'Early bird', modifierType: 'FLAT', modifierValue: 1000, applyTo: 'order_total', conditions: [{ key: 'booking_date_before', value: '2030-01-01' }] }
    expect(discountAmount(rule, ctx(), NOW)).toBe(1000)
    const past: DiscountRule = { ...rule, conditions: [{ key: 'booking_date_before', value: '2020-01-01' }] }
    expect(discountAmount(past, ctx(), NOW)).toBe(0)
  })

  it('cheapest_item FLAT caps at the cheapest line', () => {
    const rule: DiscountRule = { name: 'One free-ish', modifierType: 'FLAT', modifierValue: 1000, applyTo: 'cheapest_item' }
    expect(discountAmount(rule, ctx(), NOW)).toBe(1000) // cheapest 1500 ≥ 1000
    expect(discountAmount({ ...rule, modifierValue: 2000 }, ctx(), NOW)).toBe(1500) // capped at cheapest
  })

  it('per_item PERCENT sums across lines', () => {
    const rule: DiscountRule = { name: '10% each', modifierType: 'PERCENT', modifierValue: 10, applyTo: 'per_item' }
    expect(discountAmount(rule, ctx({ positiveAmounts: [1000, 2000] }), NOW)).toBe(300)
  })
})

describe('conditions that fail closed', () => {
  it('member_status is withheld until the server resolves membership', () => {
    const rule: DiscountRule = { name: 'Members', modifierType: 'PERCENT', modifierValue: 20, applyTo: 'order_total', conditions: [{ key: 'member_status', value: 'active' }] }
    expect(discountAmount(rule, ctx(), NOW)).toBe(0) // membershipStatus unset
    expect(discountAmount(rule, ctx({ membershipStatus: 'active' }), NOW)).toBe(6900 * 0.2)
  })

  it('an expired discount never applies', () => {
    const rule: DiscountRule = { name: 'Gone', modifierType: 'FLAT', modifierValue: 1000, applyTo: 'order_total', expiresAt: '2026-07-01T00:00:00.000Z' }
    expect(discountAmount(rule, ctx(), NOW)).toBe(0)
  })
})

describe('aggregation', () => {
  it('applicableDiscounts lists only the ones that bite', () => {
    const rules: DiscountRule[] = [
      { name: 'Whole day', modifierType: 'REPLACE', modifierValue: 5500, applyTo: 'order_total', conditions: [{ key: 'booked_full_day' }] },
      { name: 'Second dog', modifierType: 'PERCENT', modifierValue: 25, applyTo: 'per_person', conditions: [{ key: 'group_size_min', operator: '>=', value: 2 }] },
    ]
    const lines = applicableDiscounts(rules, ctx({ fullDay: true, personCount: 1 }), NOW)
    expect(lines.map(l => l.name)).toEqual(['Whole day'])
  })

  it('oneOnly keeps the single best discount per subject', () => {
    const perSubject = [[
      { name: 'A', formText: 'A', amount: 400 },
      { name: 'B', formText: 'B', amount: 900 },
    ]]
    expect(aggregateDiscountLines(perSubject, true)).toEqual([{ name: 'B', formText: 'B', amount: 900 }])
    expect(aggregateDiscountLines(perSubject, false).reduce((s, l) => s + l.amount, 0)).toBe(1300)
  })

  it('evaluateBooking totals across subjects (two dogs, sibling each)', () => {
    const rules: DiscountRule[] = [
      { name: 'Second dog', modifierType: 'PERCENT', modifierValue: 25, applyTo: 'per_person', conditions: [{ key: 'group_size_min', operator: '>=', value: 2 }] },
    ]
    const dog = ctx({ personCount: 2, personTotal: 3450, positiveAmounts: [3450] })
    const { total } = evaluateBooking(rules, [dog, dog], { oneOnly: false, now: NOW })
    // Exact cents (rounding is the caller's job, same as the FM engine).
    expect(total).toBe(3450 * 0.25 * 2)
  })
})
