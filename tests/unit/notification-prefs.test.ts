import { describe, it, expect, vi, beforeEach } from 'vitest'

// Per-org resolution logic for resolvePref / resolvePrefsForPairs. Resolution
// order is: per-org override row → the user's global (companyId null) row → the
// type's hard-coded defaults. We mock prisma so each test controls exactly which
// rows "exist" and assert the merge picks the right one.

const h = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { notificationPreference: { findMany: h.findMany } },
}))

import { resolvePref, resolvePrefsForPairs } from '@/lib/notification-prefs'
import { NOTIFICATION_TYPES } from '@/lib/notification-types'

// A full stored-row shape (only the fields merge() reads matter).
function row(over: Record<string, unknown>) {
  return {
    enabled: true,
    minutesBefore: null,
    dailyAtHour: null,
    customTitle: null,
    customBody: null,
    companyId: null,
    ...over,
  }
}

beforeEach(() => h.findMany.mockReset())

describe('resolvePref — per-org override → global → default fallback', () => {
  it('falls back to the type DEFAULTS when no row exists', async () => {
    h.findMany.mockResolvedValue([])
    const res = await resolvePref('u1', 'SESSION_REMINDER', 'EMAIL')
    const def = NOTIFICATION_TYPES.SESSION_REMINDER.defaults
    expect(res.enabled).toBe(def.enabled)
    expect(res.title).toBe(def.title)
    expect(res.body).toBe(def.body)
    expect(res.minutesBefore).toBe(def.minutesBefore)
  })

  it('uses the GLOBAL (companyId null) row when querying without a company', async () => {
    h.findMany.mockResolvedValue([
      row({ companyId: null, enabled: false, customTitle: 'Global title', customBody: 'Global body' }),
    ])
    const res = await resolvePref('u1', 'SESSION_REMINDER', 'EMAIL')
    expect(res.enabled).toBe(false)
    expect(res.title).toBe('Global title')
    expect(res.body).toBe('Global body')
    // When called with no companyId, the query must be scoped to the null row only.
    expect(h.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', type: 'SESSION_REMINDER', channel: 'EMAIL', companyId: null },
    })
  })

  it('the PER-ORG override row WINS over the global row', async () => {
    h.findMany.mockResolvedValue([
      row({ companyId: null, enabled: true, customTitle: 'Global', customBody: 'Global body' }),
      row({ companyId: 'co1', enabled: false, customTitle: 'Org override', customBody: 'Org body' }),
    ])
    const res = await resolvePref('u1', 'SESSION_REMINDER', 'EMAIL', 'co1')
    expect(res.enabled).toBe(false)
    expect(res.title).toBe('Org override')
    expect(res.body).toBe('Org body')
    // With a companyId the query widens to OR(this org, global).
    expect(h.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        type: 'SESSION_REMINDER',
        channel: 'EMAIL',
        OR: [{ companyId: 'co1' }, { companyId: null }],
      },
    })
  })

  it('falls back to the GLOBAL row when an org is requested but has no override', async () => {
    h.findMany.mockResolvedValue([
      row({ companyId: null, customTitle: 'Shared baseline' }),
    ])
    const res = await resolvePref('u1', 'SESSION_REMINDER', 'EMAIL', 'co-without-override')
    expect(res.title).toBe('Shared baseline')
  })

  it('falls back to DEFAULTS when neither an org nor a global row exists for that org', async () => {
    h.findMany.mockResolvedValue([])
    const res = await resolvePref('u1', 'SESSION_REMINDER', 'EMAIL', 'co1')
    expect(res.title).toBe(NOTIFICATION_TYPES.SESSION_REMINDER.defaults.title)
  })

  it('individual null fields fall back to defaults even when a row exists (partial merge)', async () => {
    h.findMany.mockResolvedValue([
      row({ companyId: null, enabled: false, customTitle: null, customBody: null }),
    ])
    const res = await resolvePref('u1', 'SESSION_REMINDER', 'EMAIL')
    expect(res.enabled).toBe(false) // from the row
    // null customTitle/customBody → fall through to type defaults
    expect(res.title).toBe(NOTIFICATION_TYPES.SESSION_REMINDER.defaults.title)
    expect(res.body).toBe(NOTIFICATION_TYPES.SESSION_REMINDER.defaults.body)
  })
})

describe('resolvePrefsForPairs — batch resolution, each pair scoped to its own org', () => {
  it('resolves each (user, org) pair against org override → its global → default', async () => {
    // u1 has an org override for co1 + a global row; u2 has only a global row;
    // u3 has nothing.
    h.findMany.mockResolvedValue([
      row({ userId: 'u1', companyId: 'co1', customTitle: 'u1@co1' }),
      row({ userId: 'u1', companyId: null, customTitle: 'u1 global' }),
      row({ userId: 'u2', companyId: null, customTitle: 'u2 global' }),
    ])
    const map = await resolvePrefsForPairs(
      [
        { userId: 'u1', companyId: 'co1' },
        { userId: 'u2', companyId: 'co2' },
        { userId: 'u3', companyId: 'co1' },
      ],
      'SESSION_REMINDER',
      'EMAIL',
    )
    expect(map.get('u1:co1')!.title).toBe('u1@co1')        // org override wins
    expect(map.get('u2:co2')!.title).toBe('u2 global')      // no override → global
    expect(map.get('u3:co1')!.title)                        // nothing → default
      .toBe(NOTIFICATION_TYPES.SESSION_REMINDER.defaults.title)
  })

  it('queries once for all distinct user ids', async () => {
    h.findMany.mockResolvedValue([])
    await resolvePrefsForPairs(
      [{ userId: 'a', companyId: 'x' }, { userId: 'a', companyId: 'y' }, { userId: 'b', companyId: null }],
      'NEW_MESSAGE',
      'PUSH',
    )
    expect(h.findMany).toHaveBeenCalledTimes(1)
    const call = h.findMany.mock.calls[0][0]
    expect(call.where.userId.in.sort()).toEqual(['a', 'b'])
  })
})
