import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant + ownership guards on the timesheet routes. Every route resolves the
// caller via getTrainerContext (membership-aware), then scopes Prisma to
// (companyId, userId). We mock the context + each Prisma method the handlers use
// and assert the real status codes + that mutations are NOT made cross-tenant.

const h = vi.hoisted(() => ({
  ctx: vi.fn(),
  // timesheet
  tsFindFirst: vi.fn(),
  tsFindMany: vi.fn(),
  tsCreate: vi.fn(),
  tsUpdate: vi.fn(),
  tsUpdateMany: vi.fn(),
  tsDelete: vi.fn(),
  // entries
  entryFindMany: vi.fn(),
  entryFindFirst: vi.fn(),
  entryCreate: vi.fn(),
  entryUpdate: vi.fn(),
  entryDelete: vi.fn(),
  // related reads
  trainerFindUnique: vi.fn(),
  clientFindMany: vi.fn(),
  rateFindMany: vi.fn(),
  // line helpers
  resolveLine: vi.fn(),
  resolveClientId: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.ctx }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    timesheet: {
      findFirst: h.tsFindFirst,
      findMany: h.tsFindMany,
      create: h.tsCreate,
      update: h.tsUpdate,
      updateMany: h.tsUpdateMany,
      delete: h.tsDelete,
    },
    timeEntry: {
      findMany: h.entryFindMany,
      findFirst: h.entryFindFirst,
      create: h.entryCreate,
      update: h.entryUpdate,
      delete: h.entryDelete,
    },
    trainerProfile: { findUnique: h.trainerFindUnique },
    clientProfile: { findMany: h.clientFindMany },
    timeRate: { findMany: h.rateFindMany },
  },
}))
vi.mock('@/lib/timesheet-line', () => ({
  entrySchema: {
    safeParse: (v: unknown) => {
      const d = v as Record<string, unknown> | null
      if (!d || typeof d.task !== 'string' || typeof d.date !== 'string' || typeof d.minutes !== 'number') {
        return { success: false, error: { flatten: () => ({}) } }
      }
      return { success: true, data: d }
    },
  },
  resolveLine: h.resolveLine,
  resolveClientId: h.resolveClientId,
}))

import { GET as listGET, POST as createPOST } from '@/app/api/timesheets/route'
import { GET as detailGET, PATCH as detailPATCH, DELETE as detailDELETE } from '@/app/api/timesheets/[id]/route'
import { POST as entryPOST } from '@/app/api/timesheets/[id]/entries/route'
import { PATCH as entryPATCH, DELETE as entryDELETE } from '@/app/api/timesheets/[id]/entries/[entryId]/route'
import { POST as finalisePOST, DELETE as reopenDELETE } from '@/app/api/timesheets/[id]/finalise/route'

const OWNER = { userId: 'u1', companyId: 'co1', membershipId: 'm1', role: 'OWNER', permissions: {} }

function p(id: string) {
  return { params: Promise.resolve({ id }) }
}
function pe(id: string, entryId: string) {
  return { params: Promise.resolve({ id, entryId }) }
}
function jreq(body: unknown, method = 'POST') {
  return new Request('https://app.pupmanager.com/api/x', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}
const plain = (method: string) => new Request('https://app.pupmanager.com/api/x', { method })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.resolveLine.mockResolvedValue({ rateId: null, rateName: null, rateCents: null, amountCents: 0 })
  h.resolveClientId.mockResolvedValue(null)
})

describe('timesheets list/create — auth', () => {
  it('GET rejects a non-trainer session with 401 and queries nothing', async () => {
    h.ctx.mockResolvedValue(null)
    const res = await listGET(plain('GET'))
    expect(res.status).toBe(401)
    expect(h.tsFindMany).not.toHaveBeenCalled()
  })

  it('GET scopes findMany to the caller (companyId + userId)', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindMany.mockResolvedValue([])
    await listGET(plain('GET'))
    expect(h.tsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co1', userId: 'u1' } }),
    )
  })

  it('POST ignores smuggled companyId/userId (mass-assignment) — uses the context', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsCreate.mockResolvedValue({ id: 'ts1' })
    await createPOST(jreq({ title: 'X', companyId: 'EVIL', userId: 'EVIL' }))
    const arg = h.tsCreate.mock.calls[0][0]
    expect(arg.data.companyId).toBe('co1')
    expect(arg.data.userId).toBe('u1')
  })

  it('POST rejects an unauthenticated caller with 401', async () => {
    h.ctx.mockResolvedValue(null)
    const res = await createPOST(jreq({ title: 'X' }))
    expect(res.status).toBe(401)
    expect(h.tsCreate).not.toHaveBeenCalled()
  })
})

describe('timesheet detail — cross-tenant ownership', () => {
  it('GET returns 404 (no leak) when the timesheet belongs to another tenant', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue(null) // ownership-scoped lookup finds nothing
    const res = await detailGET(plain('GET'), p('FOREIGN'))
    expect(res!.status).toBe(404)
    // Owners/managers can reach any sheet in their company, so the lookup is
    // tenant-scoped by companyId (not pinned to their own userId). Cross-tenant
    // isolation is still enforced by companyId.
    expect(h.tsFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'FOREIGN', companyId: 'co1' } }),
    )
  })

  it('PATCH on a foreign timesheet returns 404 and does NOT update', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue(null)
    const res = await detailPATCH(jreq({ title: 'pwned' }, 'PATCH'), p('FOREIGN'))
    expect(res!.status).toBe(404)
    expect(h.tsUpdate).not.toHaveBeenCalled()
  })

  it('DELETE on a foreign timesheet returns 404 and does NOT delete', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue(null)
    const res = await detailDELETE(plain('DELETE'), p('FOREIGN'))
    expect(res!.status).toBe(404)
    expect(h.tsDelete).not.toHaveBeenCalled()
  })

  it('PATCH succeeds on an owned timesheet', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue({ id: 'ts1', status: 'DRAFT' })
    h.tsUpdate.mockResolvedValue({})
    const res = await detailPATCH(jreq({ title: 'New' }, 'PATCH'), p('ts1'))
    expect(res!.status).toBe(200)
    expect(h.tsUpdate).toHaveBeenCalledTimes(1)
  })
})

describe('entries create — draft gate + ownership', () => {
  it('rejects when the timesheet is foreign (404), no create', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue(null)
    const res = await entryPOST(jreq({ date: '2026-06-22', task: 'Walk', minutes: 60 }), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.entryCreate).not.toHaveBeenCalled()
  })

  it('rejects adding an entry to a FINALISED timesheet with 409', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue({ status: 'FINALISED' })
    const res = await entryPOST(jreq({ date: '2026-06-22', task: 'Walk', minutes: 60 }), p('ts1'))
    expect(res.status).toBe(409)
    expect(h.entryCreate).not.toHaveBeenCalled()
  })

  it('creates an entry on an owned DRAFT timesheet', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue({ status: 'DRAFT' })
    h.entryFindFirst.mockResolvedValue({ sortOrder: 2 })
    h.entryCreate.mockResolvedValue({ id: 'e1' })
    const res = await entryPOST(jreq({ date: '2026-06-22', task: 'Walk', minutes: 60 }), p('ts1'))
    expect(res.status).toBe(200)
    expect(h.entryCreate).toHaveBeenCalledTimes(1)
    // sortOrder appended after the last entry.
    expect(h.entryCreate.mock.calls[0][0].data.sortOrder).toBe(3)
  })
})

describe('entry detail — draft gate + entry-belongs-to-sheet', () => {
  it('PATCH rejects when the parent timesheet is foreign (404)', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue(null)
    const res = await entryPATCH(jreq({ date: '2026-06-22', task: 'X', minutes: 30 }, 'PATCH'), pe('FOREIGN', 'e1'))
    expect(res!.status).toBe(404)
    expect(h.entryUpdate).not.toHaveBeenCalled()
  })

  it('PATCH rejects edits to a FINALISED timesheet with 409', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue({ status: 'FINALISED' })
    const res = await entryPATCH(jreq({ date: '2026-06-22', task: 'X', minutes: 30 }, 'PATCH'), pe('ts1', 'e1'))
    expect(res!.status).toBe(409)
    expect(h.entryUpdate).not.toHaveBeenCalled()
  })

  it('PATCH returns 404 when the entry is not in this timesheet', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue({ status: 'DRAFT' })
    h.entryFindFirst.mockResolvedValue(null) // entry not scoped to this sheet
    const res = await entryPATCH(jreq({ date: '2026-06-22', task: 'X', minutes: 30 }, 'PATCH'), pe('ts1', 'FOREIGN-entry'))
    expect(res!.status).toBe(404)
    expect(h.entryUpdate).not.toHaveBeenCalled()
  })

  it('DELETE removes an owned draft entry', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue({ status: 'DRAFT' })
    h.entryFindFirst.mockResolvedValue({ id: 'e1' })
    h.entryDelete.mockResolvedValue({})
    const res = await entryDELETE(plain('DELETE'), pe('ts1', 'e1'))
    expect(res!.status).toBe(200)
    expect(h.entryDelete).toHaveBeenCalledWith({ where: { id: 'e1' } })
  })
})

describe('finalise / reopen', () => {
  it('finalise rejects a foreign timesheet with 404', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue(null)
    const res = await finalisePOST(plain('POST'), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.tsUpdate).not.toHaveBeenCalled()
  })

  it('finalise refuses an empty timesheet with 400', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue({ status: 'DRAFT', _count: { entries: 0 } })
    const res = await finalisePOST(plain('POST'), p('ts1'))
    expect(res.status).toBe(400)
    expect(h.tsUpdate).not.toHaveBeenCalled()
  })

  it('finalise locks a non-empty draft', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsFindFirst.mockResolvedValue({ status: 'DRAFT', _count: { entries: 2 } })
    h.tsUpdate.mockResolvedValue({})
    const res = await finalisePOST(plain('POST'), p('ts1'))
    expect(res.status).toBe(200)
    expect(h.tsUpdate.mock.calls[0][0].data.status).toBe('FINALISED')
  })

  it('reopen is tenant-scoped via updateMany and 404s when nothing matched', async () => {
    h.ctx.mockResolvedValue(OWNER)
    h.tsUpdateMany.mockResolvedValue({ count: 0 })
    const res = await reopenDELETE(plain('DELETE'), p('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.tsUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'FOREIGN', companyId: 'co1', status: 'FINALISED' },
      }),
    )
  })
})

// The owner/manager relaxation above must NOT leak to STAFF: a plain staff
// member's lookups stay pinned to their own userId, so they can't reach a
// teammate's sheet even within the same company.
describe('timesheet detail — staff stay self-scoped', () => {
  const STAFF = { userId: 'u2', companyId: 'co1', membershipId: 'm2', role: 'STAFF', permissions: {} }
  it('GET scopes a staff lookup to their own userId', async () => {
    h.ctx.mockResolvedValue(STAFF)
    h.tsFindFirst.mockResolvedValue(null)
    const res = await detailGET(plain('GET'), p('TEAMMATE_SHEET'))
    expect(res!.status).toBe(404)
    expect(h.tsFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'TEAMMATE_SHEET', companyId: 'co1', userId: 'u2' } }),
    )
  })
})
