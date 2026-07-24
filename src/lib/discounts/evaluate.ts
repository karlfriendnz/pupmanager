// System-wide discount evaluator — a standalone port of the FM-events engine
// (composables/useDiscountEval.ts), copied into PupManager and owned here (no
// shared package, no cross-repo dependency). One implementation drives the
// builder preview, the client booking preview AND the server re-check, so the
// price a client is shown is the price they're charged.
//
// Pure and unit-agnostic: callers build a context from the booking and feed
// amounts in cents. Conditions that can't be resolved client-side (membership,
// first-N) FAIL CLOSED here and are re-checked authoritatively on the server.

export type ModifierType = 'PERCENT' | 'FLAT' | 'REPLACE'
export type ApplyTo = 'per_item' | 'per_person' | 'cheapest_item' | 'most_expensive_item' | 'order_total'

export interface DiscountCondition {
  key: string
  operator?: string
  // JSON-shaped: number | string | { min, max } | period object | { fieldId, val }.
  value?: unknown
}

export interface DiscountRule {
  id?: string
  name: string
  formText?: string | null
  isActive?: boolean
  validFrom?: string | Date | null
  expiresAt?: string | Date | null
  modifierType: ModifierType
  // For PERCENT: percent off. For FLAT: cents off. For REPLACE: the set price in cents.
  modifierValue: number
  applyTo?: ApplyTo
  conditions?: DiscountCondition[]
}

export interface DiscountCtx {
  personCount: number // subjects in this booking (e.g. dogs booked together)
  personTotal: number // this subject's total before discount (cents)
  positiveAmounts: number[] // this subject's positive line amounts (cents)
  selectedItemCount: number // items/sessions selected (incl. required)
  dayCount: number // distinct days with any selection
  fullDay: boolean // booked EVERY part of at least one day
  fullWeek: boolean // booked EVERY part of at least one week
  age: number | null
  selectedItemDates?: string[] // ISO dates of selected items (for "within a period")
  membershipStatus?: string | null // resolved server-side; unset → member conditions fail closed
  registrationIndex?: number | null // 1-based position (first-N); unset → fails closed
  fieldAnswers?: Record<string, unknown>
}

const DAY_MS = 86_400_000
function startOfDayMs(d: Date): number { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime() }

function withinPeriodMet(v: any, ctx: DiscountCtx): boolean {
  const count = Number(v?.count)
  if (!count || count <= 0) return true
  const unit = v?.unit === 'days' ? 'days' : 'items'
  const times = (ctx.selectedItemDates ?? [])
    .map(s => new Date(s)).filter(d => !isNaN(d.getTime())).map(startOfDayMs).sort((a, b) => a - b)
  if (!times.length) return false
  const units = unit === 'days' ? [...new Set(times)] : times
  if (v?.window === 'range') {
    const from = v?.from ? startOfDayMs(new Date(v.from)) : null
    const to = v?.to ? startOfDayMs(new Date(v.to)) : null
    return units.filter(t => (from == null || t >= from) && (to == null || t <= to)).length >= count
  }
  const windowDays = Number(v?.windowDays)
  if (!windowDays || windowDays <= 0) return false
  const span = windowDays * DAY_MS
  let lo = 0
  for (let hi = 0; hi < units.length; hi++) {
    while (units[hi] - units[lo] >= span) lo++
    if (hi - lo + 1 >= count) return true
  }
  return false
}

function op(actual: number, operator: string | undefined, expected: unknown): boolean {
  const e = Number(expected)
  switch (operator) {
    case '>=': return actual >= e
    case '>': return actual > e
    case '<=': return actual <= e
    case '<': return actual < e
    case '=': return actual === e
    default: return true
  }
}

export function conditionMet(cond: DiscountCondition, ctx: DiscountCtx): boolean {
  const value = cond.value as any
  switch (cond.key) {
    case 'group_size_min': return op(ctx.personCount, cond.operator, value)
    case 'booked_item_count_min': return op(ctx.selectedItemCount, cond.operator, value)
    case 'booked_day_count_min': return op(ctx.dayCount, cond.operator, value)
    case 'order_total_value_min': return op(ctx.personTotal, cond.operator, value)
    case 'booking_date_before': return !value || new Date() <= new Date(value)
    case 'booked_full_day': return ctx.fullDay
    case 'booked_full_week': return ctx.fullWeek
    case 'booked_units_within_period': return withinPeriodMet(value, ctx)
    case 'age_between': {
      if (ctx.age == null) return false
      const min = value?.min, max = value?.max
      return (min == null || ctx.age >= Number(min)) && (max == null || ctx.age <= Number(max))
    }
    case 'age_min': return ctx.age != null && op(ctx.age, cond.operator, value)
    case 'age_max': return ctx.age != null && op(ctx.age, cond.operator, value)
    case 'member_status': {
      if (ctx.membershipStatus == null) return false
      return cond.operator === 'is_not' ? ctx.membershipStatus !== value : ctx.membershipStatus === value
    }
    case 'within_first_n': return ctx.registrationIndex != null && op(ctx.registrationIndex, cond.operator || '<=', value)
    case 'promo_code': return false // typed promo codes are a fast-follow
    case 'custom_field': {
      const fid = value?.fieldId
      const ans = fid ? ctx.fieldAnswers?.[fid] : undefined
      if (ans == null || ans === '') return false
      const needle = value?.val
      switch (cond.operator) {
        case 'equals': return String(ans) === String(needle)
        case 'is_not': return String(ans) !== String(needle)
        case 'contains': return String(ans).toLowerCase().includes(String(needle ?? '').toLowerCase())
        case 'between': return Number(ans) >= Number(needle?.min) && Number(ans) <= Number(needle?.max)
        default: return op(Number(ans), cond.operator, needle)
      }
    }
    default: return true
  }
}

/** Live right now? Enforces isActive + the validity window. */
export function discountActive(disc: DiscountRule, now: Date = new Date()): boolean {
  if (disc.isActive === false) return false
  if (disc.validFrom && new Date(disc.validFrom) > now) return false
  if (disc.expiresAt && new Date(disc.expiresAt) < now) return false
  return true
}

/** The saving (cents) for one subject, or 0 if it doesn't apply. */
export function discountAmount(disc: DiscountRule, ctx: DiscountCtx, now: Date = new Date()): number {
  if (!discountActive(disc, now)) return 0
  for (const cond of disc.conditions ?? []) if (!conditionMet(cond, ctx)) return 0
  const v = Number(disc.modifierValue ?? 0)
  const type = disc.modifierType
  const pos = ctx.positiveAmounts
  const sum = pos.reduce((s, a) => s + a, 0)
  const pct = (base: number) => base * v / 100

  switch (disc.applyTo ?? 'order_total') {
    case 'per_item':
      return type === 'PERCENT' ? pos.reduce((s, a) => s + pct(a), 0)
        : type === 'REPLACE' ? pos.reduce((s, a) => s + Math.max(0, a - v), 0)
          : Math.min(pos.length * v, sum)
    case 'per_person':
      return type === 'PERCENT' ? pct(ctx.personTotal) : type === 'REPLACE' ? Math.max(0, ctx.personTotal - v) : Math.min(v, ctx.personTotal)
    case 'cheapest_item': {
      if (!pos.length) return 0
      const c = Math.min(...pos)
      return type === 'PERCENT' ? pct(c) : type === 'REPLACE' ? Math.max(0, c - v) : Math.min(v, c)
    }
    case 'most_expensive_item': {
      if (!pos.length) return 0
      const e = Math.max(...pos)
      return type === 'PERCENT' ? pct(e) : type === 'REPLACE' ? Math.max(0, e - v) : Math.min(v, e)
    }
    case 'order_total':
    default:
      return type === 'PERCENT' ? pct(ctx.personTotal) : type === 'REPLACE' ? Math.max(0, ctx.personTotal - v) : Math.min(v, ctx.personTotal)
  }
}

export interface DiscountLine { name: string; formText: string; amount: number }

/** Per-subject applicable discounts (name/formText/amount cents), active only. */
export function applicableDiscounts(discounts: DiscountRule[], ctx: DiscountCtx, now: Date = new Date()): DiscountLine[] {
  const out: DiscountLine[] = []
  for (const disc of (discounts ?? []).filter(d => discountActive(d, now))) {
    const amount = discountAmount(disc, ctx, now)
    if (amount > 0) out.push({ name: disc.name, formText: disc.formText || disc.name, amount })
  }
  return out
}

/** Roll per-subject discounts into display lines; oneOnly keeps the best per subject. */
export function aggregateDiscountLines(perSubject: DiscountLine[][], oneOnly: boolean): DiscountLine[] {
  const map = new Map<string, DiscountLine>()
  for (const subject of perSubject) {
    const relevant = oneOnly && subject.length > 1 ? [subject.reduce((a, b) => (a.amount >= b.amount ? a : b))] : subject
    for (const d of relevant) {
      const existing = map.get(d.name)
      if (existing) existing.amount += d.amount
      else map.set(d.name, { name: d.name, formText: d.formText, amount: d.amount })
    }
  }
  return [...map.values()]
}

/** Convenience for a whole booking: total saving + display lines across subjects. */
export function evaluateBooking(
  discounts: DiscountRule[],
  subjects: DiscountCtx[],
  opts: { oneOnly?: boolean; now?: Date } = {},
): { lines: DiscountLine[]; total: number } {
  const now = opts.now ?? new Date()
  const perSubject = subjects.map(ctx => applicableDiscounts(discounts, ctx, now))
  const lines = aggregateDiscountLines(perSubject, opts.oneOnly ?? false)
  return { lines, total: lines.reduce((s, l) => s + l.amount, 0) }
}
