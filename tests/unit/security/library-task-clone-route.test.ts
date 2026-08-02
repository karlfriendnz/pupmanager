import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// POST /api/library/tasks/:taskId/clone — duplicate one library item. The
// security question is the same one the whole Library asks: ownership lives two
// levels up (item → theme → type → trainer), and a stranger's item must not be
// copyable INTO the caller's own library either.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    libraryTask: { findFirst: h.findFirst, updateMany: h.updateMany, create: h.create },
    $transaction: h.transaction,
  },
}))

import { POST } from '@/app/api/library/tasks/[taskId]/clone/route'

const OWNER = { companyId: 'company-A', userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} }

const ORIGINAL = {
  id: 'item-1',
  themeId: 'theme-1',
  title: 'Sit',
  description: '<p>Ask for a <strong>sit</strong></p>',
  repetitions: 5,
  wantsLog: false,
  videoUrl: 'https://example.com/v.mp4',
  imageUrl: 'https://example.com/i.png',
  fileUrl: 'https://example.com/h.pdf',
  fileName: 'handout.pdf',
  order: 3,
}

function call(taskId = 'item-1') {
  return POST(new Request('http://localhost/clone', { method: 'POST' }), {
    params: Promise.resolve({ taskId }),
  })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue(OWNER)
  h.findFirst.mockResolvedValue(ORIGINAL)
  h.create.mockResolvedValue({ id: 'item-copy', title: 'Sit (copy)' })
  // Run the transaction callback against the same mocked delegate.
  h.transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn({ libraryTask: { updateMany: h.updateMany, create: h.create } }),
  )
})

describe('POST /api/library/tasks/:taskId/clone — permission', () => {
  it('hands back the guard’s own response and copies nothing', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/library/tasks/:taskId/clone — tenant scoping', () => {
  it('looks the item up through its theme’s type, scoped to the caller', async () => {
    await call('item-1')
    expect(h.findFirst).toHaveBeenCalledWith({
      where: { id: 'item-1', theme: { type: { trainerId: 'company-A' } } },
    })
  })

  it('404s on another trainer’s item, and creates nothing', async () => {
    h.findFirst.mockResolvedValue(null)
    const res = await call('someone-elses')
    expect(res.status).toBe(404)
    expect(h.create).not.toHaveBeenCalled()
    expect(h.transaction).not.toHaveBeenCalled()
  })
})

describe('POST /api/library/tasks/:taskId/clone — the copy', () => {
  it('carries every field across, into the same theme', async () => {
    await call()
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        themeId: 'theme-1',
        title: 'Sit (copy)',
        description: ORIGINAL.description,
        repetitions: 5,
        // Reference material stays reference material — a copy that silently
        // started asking the client to log sessions would be a different item.
        wantsLog: false,
        videoUrl: ORIGINAL.videoUrl,
        imageUrl: ORIGINAL.imageUrl,
        fileUrl: ORIGINAL.fileUrl,
        fileName: 'handout.pdf',
      }),
    }))
  })

  it('lands directly below the original, shifting what was under it', async () => {
    await call()
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { themeId: 'theme-1', order: { gt: 3 } },
      data: { order: { increment: 1 } },
    })
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ order: 4 }),
    }))
  })

  it('makes room and creates in ONE transaction', async () => {
    await call()
    // Otherwise a failure between the two leaves a gap in the order, or two
    // items claiming the same position.
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })

  it('returns the copy’s id, so the caller can open it', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ id: 'item-copy', title: 'Sit (copy)' })
  })
})
