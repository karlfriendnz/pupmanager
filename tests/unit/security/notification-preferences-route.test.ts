import { describe, it, expect, vi, beforeEach } from 'vitest'

// Authz + per-org upsert correctness for the notification-preferences route.
// The PUT respects the (userId, companyId, type, channel) key: it finds the
// existing row for that exact tuple and updates it, else creates one. Trainer-
// audience prefs are scoped to the active org from getTrainerContext (a trainer
// can't write a row for a company they don't belong to — the active company is
// derived server-side, never taken from the request). Client-audience prefs are
// forced to companyId null.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  getTrainerContext: vi.fn(),
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    notificationPreference: {
      findMany: h.findMany,
      findFirst: h.findFirst,
      update: h.update,
      create: h.create,
    },
  },
}))

import { GET, PUT } from '@/app/api/notification-preferences/route'

const jsonReq = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/notification-preferences', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.findMany.mockResolvedValue([])
  h.findFirst.mockResolvedValue(null)
  h.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'p1', ...data }))
  h.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'existing', ...data }))
})

describe('notification-preferences — authentication', () => {
  it('GET returns 401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    expect((await GET(new Request('http://localhost/api/notification-preferences'))).status).toBe(401)
  })

  it('PUT returns 401 when unauthenticated', async () => {
    h.auth.mockResolvedValue(null)
    const res = await PUT(jsonReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true }))
    expect(res.status).toBe(401)
    expect(h.create).not.toHaveBeenCalled()
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('notification-preferences PUT — input validation', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.getTrainerContext.mockResolvedValue({ userId: 'u1', companyId: 'co1', role: 'OWNER', permissions: {} })
  })

  it('rejects an unknown notification type with 400', async () => {
    const res = await PUT(jsonReq({ type: 'NOT_A_TYPE', channel: 'EMAIL' }))
    expect(res.status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('rejects a channel the type does not support with 400', async () => {
    // SESSION_REMINDER supports PUSH + EMAIL only — IN_APP is invalid.
    const res = await PUT(jsonReq({ type: 'SESSION_REMINDER', channel: 'IN_APP' }))
    expect(res.status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('rejects an oversized customBody (> 20k) with 400', async () => {
    const res = await PUT(jsonReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', customBody: 'x'.repeat(20_001) }))
    expect(res.status).toBe(400)
  })
})

describe('notification-preferences PUT — per-org upsert key & tenant scoping', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
  })

  it('creates a row scoped to the ACTIVE company for a trainer-audience type', async () => {
    h.getTrainerContext.mockResolvedValue({ userId: 'u1', companyId: 'active-co', role: 'OWNER', permissions: {} })
    const res = await PUT(jsonReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: false }))
    expect(res.status).toBe(200)
    // The trainer cannot choose the company — it's the active org, server-side.
    expect(h.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'u1', companyId: 'active-co', type: 'NEW_MESSAGE', channel: 'EMAIL' },
    }))
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', companyId: 'active-co', type: 'NEW_MESSAGE', channel: 'EMAIL' }),
    }))
  })

  it('forces companyId null for CLIENT-audience prefs even with an active company', async () => {
    h.getTrainerContext.mockResolvedValue({ userId: 'u1', companyId: 'active-co', role: 'OWNER', permissions: {} })
    const res = await PUT(jsonReq({ type: 'CLIENT_NEW_MESSAGE', channel: 'EMAIL', enabled: true }))
    expect(res.status).toBe(200)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: null, type: 'CLIENT_NEW_MESSAGE' }),
    }))
  })

  it('UPDATES the existing (userId,companyId,type,channel) row rather than creating a duplicate', async () => {
    h.getTrainerContext.mockResolvedValue({ userId: 'u1', companyId: 'co1', role: 'OWNER', permissions: {} })
    h.findFirst.mockResolvedValue({ id: 'existing-row' })
    const res = await PUT(jsonReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: false }))
    expect(res.status).toBe(200)
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'existing-row' } }))
    expect(h.create).not.toHaveBeenCalled()
  })

  it('a user with no trainer context (companyId null) writes only their global row', async () => {
    // getTrainerContext returns null for non-trainers / no active company →
    // companyId resolves to null, i.e. the global baseline row. There is no path
    // to write a row for an arbitrary company they don't belong to.
    h.getTrainerContext.mockResolvedValue(null)
    const res = await PUT(jsonReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', enabled: true }))
    expect(res.status).toBe(200)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: null }),
    }))
  })

  it('persists a customBody override (rich-text HTML allowed for EMAIL channel)', async () => {
    h.getTrainerContext.mockResolvedValue({ userId: 'u1', companyId: 'co1', role: 'OWNER', permissions: {} })
    const body = '<p>Custom welcome {{clientName}}</p>'
    await PUT(jsonReq({ type: 'NEW_MESSAGE', channel: 'EMAIL', customBody: body }))
    expect(h.create.mock.calls[0][0].data.customBody).toBe(body)
  })
})

describe('notification-preferences GET — overlays stored on defaults, scoped to active org', () => {
  it('prefers the active-org row over the global row', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.getTrainerContext.mockResolvedValue({ userId: 'u1', companyId: 'co1', role: 'OWNER', permissions: {} })
    h.findMany.mockResolvedValue([
      { type: 'NEW_MESSAGE', channel: 'EMAIL', companyId: null, enabled: true, leadMinutes: [], customTitle: 'Global', customBody: null },
      { type: 'NEW_MESSAGE', channel: 'EMAIL', companyId: 'co1', enabled: false, leadMinutes: [], customTitle: 'Org', customBody: null },
    ])
    const res = await GET(new Request('http://localhost/api/notification-preferences'))
    expect(res.status).toBe(200)
    const { preferences } = await res.json() as { preferences: Array<Record<string, unknown>> }
    const row = preferences.find(p => p.type === 'NEW_MESSAGE' && p.channel === 'EMAIL')!
    expect(row.enabled).toBe(false)       // org row wins
    expect(row.customTitle).toBe('Org')
  })
})
