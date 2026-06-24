import { describe, it, expect, vi, beforeEach } from 'vitest'

// Per-session billable time. The session must belong to the caller's business,
// and any membership the time is attributed to must be in the same business.
// Cross-tenant sessions/entries → 404; foreign member attribution → 400.

const h = vi.hoisted(() => ({
  ctx: vi.fn(),
  sessionFindFirst: vi.fn(),
  memberFindFirst: vi.fn(),
  entryFindMany: vi.fn(),
  entryFindFirst: vi.fn(),
  entryCreate: vi.fn(),
  entryUpdate: vi.fn(),
  entryDeleteMany: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.ctx }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findFirst: h.sessionFindFirst },
    trainerMembership: { findFirst: h.memberFindFirst },
    sessionTimeEntry: {
      findMany: h.entryFindMany,
      findFirst: h.entryFindFirst,
      create: h.entryCreate,
      update: h.entryUpdate,
      deleteMany: h.entryDeleteMany,
    },
  },
}))

import { GET, POST, PATCH, DELETE } from '@/app/api/sessions/[sessionId]/time-entries/route'

const CTX = { userId: 'u1', companyId: 'co1', membershipId: 'm1', role: 'OWNER', permissions: {} }

function p(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) }
}
function jreq(body: unknown, method = 'POST') {
  return new Request('https://app.pupmanager.com/api/x', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const plain = (method: string) => new Request('https://app.pupmanager.com/api/x', { method })

const serialisable = {
  id: 'e1',
  membershipId: 'm1',
  minutes: 60,
  rateCents: 8000,
  note: null,
  createdAt: new Date('2026-06-22T00:00:00Z'),
  membership: { user: { name: 'Sam', email: 's@e.test' } },
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
})

describe('session time-entries — auth', () => {
  it('GET 401 unauthenticated, no session lookup', async () => {
    h.ctx.mockResolvedValue(null)
    const res = await GET(plain('GET'), p('sess1'))
    expect(res.status).toBe(401)
    expect(h.sessionFindFirst).not.toHaveBeenCalled()
  })
})

describe('session ownership — cross-tenant session', () => {
  it('GET 404 when the session is in another business, no entry read', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await GET(plain('GET'), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.entryFindMany).not.toHaveBeenCalled()
    expect(h.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'FOREIGN', trainerId: 'co1' } }),
    )
  })

  it('POST 404 on a foreign session, no create', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await POST(jreq({ membershipId: 'm1', minutes: 60 }), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.entryCreate).not.toHaveBeenCalled()
  })

  it('PATCH 404 on a foreign session, no update', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await PATCH(jreq({ id: 'e1', minutes: 30 }, 'PATCH'), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.entryUpdate).not.toHaveBeenCalled()
  })

  it('DELETE 404 on a foreign session, no delete', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await DELETE(jreq({ id: 'e1' }, 'DELETE'), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.entryDeleteMany).not.toHaveBeenCalled()
  })
})

describe('member attribution must be in the same business', () => {
  it('POST 400 when the attributed membership is foreign, no create', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1' })
    h.memberFindFirst.mockResolvedValue(null) // member not in this company
    const res = await POST(jreq({ membershipId: 'FOREIGN-member', minutes: 60 }), p('sess1'))
    expect(res.status).toBe(400)
    expect(h.entryCreate).not.toHaveBeenCalled()
    expect(h.memberFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'FOREIGN-member', companyId: 'co1' } }),
    )
  })

  it('POST 201 creates and stamps loggedById from the context', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1' })
    h.memberFindFirst.mockResolvedValue({ id: 'm1' })
    h.entryCreate.mockResolvedValue(serialisable)
    const res = await POST(jreq({ membershipId: 'm1', minutes: 60, rateCents: 8000 }), p('sess1'))
    expect(res.status).toBe(201)
    const data = h.entryCreate.mock.calls[0][0].data
    expect(data.sessionId).toBe('sess1')
    expect(data.loggedById).toBe('m1')
  })

  it('PATCH 400 when re-attributing to a foreign member, no update', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1' })
    h.entryFindFirst.mockResolvedValue({ id: 'e1' })
    h.memberFindFirst.mockResolvedValue(null)
    const res = await PATCH(jreq({ id: 'e1', membershipId: 'FOREIGN-member' }, 'PATCH'), p('sess1'))
    expect(res.status).toBe(400)
    expect(h.entryUpdate).not.toHaveBeenCalled()
  })
})

describe('entry must belong to the session', () => {
  it('PATCH 404 when the entry is not in this session, no update', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1' })
    h.entryFindFirst.mockResolvedValue(null) // entry not scoped to this session
    const res = await PATCH(jreq({ id: 'FOREIGN-entry', minutes: 30 }, 'PATCH'), p('sess1'))
    expect(res.status).toBe(404)
    expect(h.entryUpdate).not.toHaveBeenCalled()
    expect(h.entryFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'FOREIGN-entry', sessionId: 'sess1' } }),
    )
  })

  it('DELETE 404 when deleteMany matches nothing (entry not in session)', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1' })
    h.entryDeleteMany.mockResolvedValue({ count: 0 })
    const res = await DELETE(jreq({ id: 'FOREIGN-entry' }, 'DELETE'), p('sess1'))
    expect(res.status).toBe(404)
    expect(h.entryDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'FOREIGN-entry', sessionId: 'sess1' } }),
    )
  })

  it('DELETE 200 when the entry was removed', async () => {
    h.ctx.mockResolvedValue(CTX)
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1' })
    h.entryDeleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(jreq({ id: 'e1' }, 'DELETE'), p('sess1'))
    expect(res.status).toBe(200)
  })
})
