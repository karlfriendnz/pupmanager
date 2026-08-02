import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// The other two levels of the Library's order: themes inside a category, and
// items inside a theme. Ownership for both lives further up the tree than the
// row being written — a theme belongs to a type, an item to a theme to a type —
// so the guard these pin is that the ownership WHERE walks all the way to the
// caller's own company, and that one borrowed id writes nothing at all.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  themeCount: vi.fn(),
  themeUpdate: vi.fn(),
  taskCount: vi.fn(),
  taskUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    libraryTheme: { count: h.themeCount, update: h.themeUpdate },
    libraryTask: { count: h.taskCount, update: h.taskUpdate },
    $transaction: h.transaction,
  },
}))

import { POST as reorderThemes } from '@/app/api/library/themes/reorder/route'
import { POST as reorderTasks } from '@/app/api/library/tasks/reorder/route'

const OWNER = { companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} }

function req(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue(OWNER)
  h.themeUpdate.mockImplementation((args: unknown) => args)
  h.taskUpdate.mockImplementation((args: unknown) => args)
  h.transaction.mockResolvedValue([])
})

describe('POST /api/library/themes/reorder', () => {
  const url = 'http://localhost/api/library/themes/reorder'

  it('hands back the guard’s own response and writes nothing', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await reorderThemes(req(url, { ids: ['t1'] }))
    expect(res.status).toBe(403)
    expect(h.themeCount).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('checks ownership through the parent category', async () => {
    h.themeCount.mockResolvedValue(2)
    await reorderThemes(req(url, { ids: ['t1', 't2'] }))
    expect(h.themeCount).toHaveBeenCalledWith({
      where: { id: { in: ['t1', 't2'] }, type: { trainerId: 'company-A' } },
    })
  })

  it('writes nothing when one theme belongs to another trainer', async () => {
    h.themeCount.mockResolvedValue(1)
    const res = await reorderThemes(req(url, { ids: ['mine', 'theirs'] }))
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.themeUpdate).not.toHaveBeenCalled()
  })

  it('rejects duplicate ids', async () => {
    const res = await reorderThemes(req(url, { ids: ['t1', 't1'] }))
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('saves each id at its index, in one transaction', async () => {
    h.themeCount.mockResolvedValue(2)
    const res = await reorderThemes(req(url, { ids: ['b', 'a'] }))
    expect(res.status).toBe(200)
    expect(h.themeUpdate).toHaveBeenNthCalledWith(1, { where: { id: 'b' }, data: { order: 0 } })
    expect(h.themeUpdate).toHaveBeenNthCalledWith(2, { where: { id: 'a' }, data: { order: 1 } })
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/library/tasks/reorder', () => {
  const url = 'http://localhost/api/library/tasks/reorder'

  it('hands back the guard’s own response and writes nothing', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }))
    const res = await reorderTasks(req(url, { ids: ['i1'] }))
    expect(res.status).toBe(401)
    expect(h.taskCount).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('checks ownership two levels up — item → theme → type → trainer', async () => {
    h.taskCount.mockResolvedValue(2)
    await reorderTasks(req(url, { ids: ['i1', 'i2'] }))
    expect(h.taskCount).toHaveBeenCalledWith({
      where: { id: { in: ['i1', 'i2'] }, theme: { type: { trainerId: 'company-A' } } },
    })
  })

  it('writes nothing when one item belongs to another trainer', async () => {
    h.taskCount.mockResolvedValue(1)
    const res = await reorderTasks(req(url, { ids: ['mine', 'theirs'] }))
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
    expect(h.taskUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty list', async () => {
    const res = await reorderTasks(req(url, { ids: [] }))
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('saves each id at its index, in one transaction', async () => {
    h.taskCount.mockResolvedValue(3)
    const res = await reorderTasks(req(url, { ids: ['c', 'a', 'b'] }))
    expect(res.status).toBe(200)
    expect(h.taskUpdate).toHaveBeenNthCalledWith(1, { where: { id: 'c' }, data: { order: 0 } })
    expect(h.taskUpdate).toHaveBeenNthCalledWith(3, { where: { id: 'b' }, data: { order: 2 } })
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })
})
