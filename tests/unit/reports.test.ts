import { describe, it, expect, vi, beforeEach } from 'vitest'

// getBusinessReports fans out a dozen prisma queries via Promise.all, then
// shapes the results into a chart-ready report. We mock every prisma method it
// touches and feed deterministic fixtures, asserting the totals / grouping /
// date-bucketing / rounding / empty-dataset behaviour the function produces.
const h = vi.hoisted(() => ({
  customFieldFindMany: vi.fn(),
  customFieldValueGroupBy: vi.fn(),
  clientProfileCount: vi.fn(),
  clientProfileGroupBy: vi.fn(),
  clientProfileFindMany: vi.fn(),
  dogFindMany: vi.fn(),
  sessionGroupBy: vi.fn(),
  sessionFindMany: vi.fn(),
  timeEntryFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
  paymentItemFindMany: vi.fn(),
  enquiryGroupBy: vi.fn(),
  membershipFindMany: vi.fn(),
  taskCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    customField: { findMany: h.customFieldFindMany },
    customFieldValue: { groupBy: h.customFieldValueGroupBy },
    clientProfile: { count: h.clientProfileCount, groupBy: h.clientProfileGroupBy, findMany: h.clientProfileFindMany },
    dog: { findMany: h.dogFindMany },
    // groupBy is called for status / sessionType / topClients / sessionsByMember;
    // findMany for the scheduledAt list. The handler distinguishes them by the
    // `by` argument — our mock returns shapes keyed on that.
    trainingSession: { groupBy: h.sessionGroupBy, findMany: h.sessionFindMany },
    sessionTimeEntry: { findMany: h.timeEntryFindMany },
    payment: { findMany: h.paymentFindMany },
    paymentItem: { findMany: h.paymentItemFindMany },
    enquiry: { groupBy: h.enquiryGroupBy },
    trainerMembership: { findMany: h.membershipFindMany },
    trainingTask: { count: h.taskCount },
  },
}))

import { getBusinessReports, WEEKDAYS } from '@/lib/reports'

// A fixed "now" so date-bucketing assertions are stable.
const FIXED_NOW = new Date('2026-06-15T12:00:00Z')

function isoIn(monthsAgo: number, day = 10): Date {
  const d = new Date(FIXED_NOW)
  d.setMonth(d.getMonth() - monthsAgo)
  d.setDate(day)
  return d
}

// Default empty-ish wiring; individual tests override what they care about.
function wireDefaults() {
  h.customFieldFindMany.mockResolvedValue([])
  h.customFieldValueGroupBy.mockResolvedValue([])
  h.clientProfileCount.mockResolvedValue(0)
  h.clientProfileGroupBy.mockResolvedValue([])
  h.clientProfileFindMany.mockResolvedValue([])
  h.dogFindMany.mockResolvedValue([])
  h.sessionFindMany.mockResolvedValue([])
  h.timeEntryFindMany.mockResolvedValue([])
  h.paymentFindMany.mockResolvedValue([])
  h.paymentItemFindMany.mockResolvedValue([])
  h.enquiryGroupBy.mockResolvedValue([])
  h.membershipFindMany.mockResolvedValue([])
  h.taskCount.mockResolvedValue(0)
  // groupBy on trainingSession is used four ways; route by the `by` array.
  h.sessionGroupBy.mockImplementation((args: { by: string[] }) => {
    if (args.by.includes('status')) return Promise.resolve([])
    if (args.by.includes('sessionType')) return Promise.resolve([])
    if (args.by.includes('clientId')) return Promise.resolve([])
    if (args.by.includes('assignedMembershipId')) return Promise.resolve([])
    return Promise.resolve([])
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
  Object.values(h).forEach(fn => fn.mockReset())
  wireDefaults()
})

describe('getBusinessReports — empty dataset', () => {
  it('returns zeroed totals and safe defaults without throwing', async () => {
    const r = await getBusinessReports('trainer-1')
    expect(r.clients.total).toBe(0)
    expect(r.clients.totalDogs).toBe(0)
    expect(r.clients.dogsPerClient).toBe(0) // no divide-by-zero
    expect(r.sessions.total).toBe(0)
    expect(r.sessions.hoursTracked).toBe(0)
    expect(r.sessions.billableCents).toBe(0)
    expect(r.revenue.totalCents).toBe(0)
    expect(r.revenue.currency).toBe('nzd') // fallback when no payments
    expect(r.enquiries.total).toBe(0)
    expect(r.enquiries.accepted).toBe(0)
    expect(r.customFields).toEqual([])
    // Default range is last 12 months → 12 month buckets, all zero.
    expect(r.months.length).toBe(12)
    expect(r.clients.newPerMonth).toEqual(new Array(12).fill(0))
  })
})

describe('getBusinessReports — client & dog aggregation', () => {
  it('counts clients by status and computes dogs-per-client', async () => {
    h.clientProfileCount.mockResolvedValue(4)
    h.clientProfileGroupBy.mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 3 } },
      { status: 'INACTIVE', _count: { _all: 1 } },
    ])
    h.dogFindMany.mockResolvedValue([
      { breed: 'Labrador', dob: null },
      { breed: 'Labrador', dob: null },
      { breed: 'Poodle', dob: null },
    ])
    const r = await getBusinessReports('trainer-1')
    expect(r.clients.total).toBe(4)
    expect(r.clients.active).toBe(3)
    expect(r.clients.inactive).toBe(1)
    expect(r.clients.totalDogs).toBe(3)
    expect(r.clients.dogsPerClient).toBe(0.75)
  })

  it('tallies dog breeds (Unknown for blanks) and ages, sorted by frequency', async () => {
    h.dogFindMany.mockResolvedValue([
      { breed: 'Labrador', dob: null },
      { breed: 'Labrador', dob: null },
      { breed: '', dob: null }, // → Unknown breed
      { breed: 'Poodle', dob: new Date('2026-01-01') }, // < 1y → Puppy
    ])
    const r = await getBusinessReports('trainer-1')
    expect(r.clients.dogBreeds[0]).toEqual({ label: 'Labrador', count: 2 })
    const unknown = r.clients.dogBreeds.find(b => b.label === 'Unknown')
    expect(unknown?.count).toBe(1)
    // Age groups: one Puppy, three Unknown (null dob).
    const puppy = r.clients.dogAgeGroups.find(g => g.label === 'Puppy (<1y)')
    expect(puppy?.count).toBe(1)
    expect(r.clients.dogAgeGroups.find(g => g.label === 'Unknown')?.count).toBe(3)
  })

  it('folds breeds beyond the top 8 into an "Other" bucket', async () => {
    const dogs = []
    for (let i = 0; i < 10; i++) dogs.push({ breed: `Breed${i}`, dob: null })
    h.dogFindMany.mockResolvedValue(dogs)
    const r = await getBusinessReports('trainer-1')
    // 8 named breeds + an "Other" rollup of the remaining 2.
    expect(r.clients.dogBreeds.length).toBe(9)
    const other = r.clients.dogBreeds.find(b => b.label === 'Other')
    expect(other?.count).toBe(2)
  })

  it('buckets new clients by month within the 12-month window', async () => {
    h.clientProfileCount.mockResolvedValue(2)
    h.clientProfileFindMany.mockResolvedValue([
      { createdAt: isoIn(0) }, // this month
      { createdAt: isoIn(0) }, // this month
    ])
    const r = await getBusinessReports('trainer-1')
    // Last bucket is the current month → both land there.
    expect(r.clients.newPerMonth[r.months.length - 1]).toBe(2)
    expect(r.clients.newPerMonth.reduce((a, b) => a + b, 0)).toBe(2)
  })
})

describe('getBusinessReports — sessions & time tracking', () => {
  it('sums session status counts into the total and buckets by weekday', async () => {
    h.sessionGroupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('status')) {
        return Promise.resolve([
          { status: 'COMPLETED', _count: { _all: 5 } },
          { status: 'SCHEDULED', _count: { _all: 2 } },
        ])
      }
      return Promise.resolve([])
    })
    // Two sessions on a Monday (2026-06-15 is a Monday).
    h.sessionFindMany.mockResolvedValue([
      { scheduledAt: new Date('2026-06-15T10:00:00Z') },
      { scheduledAt: new Date('2026-06-15T11:00:00Z') },
    ])
    const r = await getBusinessReports('trainer-1')
    expect(r.sessions.total).toBe(7)
    expect(WEEKDAYS[0]).toBe('Mon')
    expect(r.sessions.byWeekday[0]).toBe(2) // Mon index
    expect(r.sessions.byWeekday.reduce((a, b) => a + b, 0)).toBe(2)
  })

  it('rounds tracked hours to one decimal and computes billable cents', async () => {
    h.timeEntryFindMany.mockResolvedValue([
      { minutes: 90, rateCents: 6000, membershipId: 'm1' }, // 1.5h @ $60 = 9000c
      { minutes: 45, rateCents: 8000, membershipId: 'm1' }, // 0.75h @ $80 = 6000c
    ])
    const r = await getBusinessReports('trainer-1')
    // 135 minutes = 2.25h → rounded to 2.3 (Math.round(22.5)/10).
    expect(r.sessions.hoursTracked).toBe(2.3)
    expect(r.sessions.billableCents).toBe(15000)
  })
})

describe('getBusinessReports — revenue', () => {
  it('nets refunds, picks the dominant currency and buckets per month', async () => {
    h.paymentFindMany.mockResolvedValue([
      { amountTotal: 10000, amountRefunded: 0, currency: 'nzd', paidAt: isoIn(0), createdAt: isoIn(0) },
      { amountTotal: 5000, amountRefunded: 2000, currency: 'nzd', paidAt: isoIn(0), createdAt: isoIn(0) },
      { amountTotal: 9999, amountRefunded: 0, currency: 'aud', paidAt: isoIn(0), createdAt: isoIn(0) }, // minority currency ignored
    ])
    const r = await getBusinessReports('trainer-1')
    expect(r.revenue.currency).toBe('nzd')
    // 10000 + (5000-2000) = 13000; the aud row is excluded.
    expect(r.revenue.totalCents).toBe(13000)
    expect(r.revenue.perMonthCents[r.months.length - 1]).toBe(13000)
  })

  it('groups revenue by purchasable kind with friendly labels', async () => {
    h.paymentFindMany.mockResolvedValue([
      { amountTotal: 1, amountRefunded: 0, currency: 'nzd', paidAt: isoIn(0), createdAt: isoIn(0) },
    ])
    h.paymentItemFindMany.mockResolvedValue([
      { kind: 'PACKAGE', unitAmount: 5000, quantity: 2, payment: { currency: 'nzd' } }, // 10000
      { kind: 'SESSION', unitAmount: 3000, quantity: 1, payment: { currency: 'nzd' } }, // 3000
      { kind: 'PRODUCT', unitAmount: 9999, quantity: 1, payment: { currency: 'aud' } }, // wrong currency, dropped
    ])
    const r = await getBusinessReports('trainer-1')
    expect(r.revenue.byType[0]).toEqual({ label: 'Packages', count: 10000 })
    expect(r.revenue.byType.find(t => t.label === 'Sessions')?.count).toBe(3000)
    expect(r.revenue.byType.find(t => t.label === 'Products')).toBeUndefined()
  })
})

describe('getBusinessReports — enquiries & engagement', () => {
  it('totals enquiries and surfaces the accepted count', async () => {
    h.enquiryGroupBy.mockResolvedValue([
      { status: 'NEW', _count: { _all: 4 } },
      { status: 'ACCEPTED', _count: { _all: 3 } },
    ])
    const r = await getBusinessReports('trainer-1')
    expect(r.enquiries.total).toBe(7)
    expect(r.enquiries.accepted).toBe(3)
  })

  it('passes through homework totals from the task counts', async () => {
    // taskCount is called twice: total, then completed.
    h.taskCount.mockResolvedValueOnce(10).mockResolvedValueOnce(6)
    const r = await getBusinessReports('trainer-1')
    expect(r.engagement.homeworkTotal).toBe(10)
    expect(r.engagement.homeworkCompleted).toBe(6)
  })
})

describe('getBusinessReports — custom fields', () => {
  it('reports filled vs total and builds a dropdown option breakdown', async () => {
    h.customFieldFindMany.mockResolvedValue([
      { id: 'f1', label: 'Source', type: 'DROPDOWN', options: ['Web', 'Referral'], appliesTo: 'OWNER' },
    ])
    h.clientProfileCount.mockResolvedValue(5)
    // First groupBy call (by fieldId) = fill counts; second (by fieldId,value) = options.
    h.customFieldValueGroupBy
      .mockResolvedValueOnce([{ fieldId: 'f1', _count: { _all: 3 } }])
      .mockResolvedValueOnce([
        { fieldId: 'f1', value: 'Web', _count: { _all: 2 } },
        { fieldId: 'f1', value: 'Referral', _count: { _all: 1 } },
      ])
    const r = await getBusinessReports('trainer-1')
    expect(r.customFields).toHaveLength(1)
    const cf = r.customFields[0]
    expect(cf.filled).toBe(3)
    expect(cf.total).toBe(5) // OWNER scope → client population
    expect(cf.optionBreakdown).toEqual([
      { option: 'Web', count: 2 },
      { option: 'Referral', count: 1 },
    ])
  })
})
