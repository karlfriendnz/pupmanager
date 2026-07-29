import { describe, it, expect, vi, beforeEach } from 'vitest'

// This route hands out a Blob WRITE TOKEN. The tenant boundary is two relations
// up (task → theme → type → trainer), so a check that forgot to walk it would let
// one business upload into another's catalogue.

const h = vi.hoisted(() => ({
  getTrainerContext: vi.fn(),
  can: vi.fn(),
  findFirst: vi.fn(),
  handleUpload: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ getTrainerContext: h.getTrainerContext }))
vi.mock('@/lib/permissions', () => ({ can: h.can }))
vi.mock('@/lib/prisma', () => ({ prisma: { libraryTask: { findFirst: h.findFirst } } }))
vi.mock('@vercel/blob/client', () => ({ handleUpload: h.handleUpload }))

import { POST } from '@/app/api/library/items/[taskId]/video-upload/route'

const params = (taskId = 'task1') => Promise.resolve({ taskId })
function req(): Request {
  return new Request('https://app.pupmanager.com/api/library/items/task1/video-upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'blob.generate-client-token' }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getTrainerContext.mockResolvedValue({ companyId: 't1', role: 'OWNER', permissions: {} })
  h.can.mockReturnValue(true)
  h.findFirst.mockResolvedValue({ id: 'task1' })
  h.handleUpload.mockResolvedValue({ type: 'blob.generate-client-token', clientToken: 'tok' })
})

describe('POST /api/library/items/[taskId]/video-upload', () => {
  it('issues a token for an item in the trainer’s own library', async () => {
    const res = await POST(req(), { params: params() })
    expect(res.status).toBe(200)
    expect(h.handleUpload).toHaveBeenCalled()
  })

  it('scopes the lookup through theme → type → trainer', async () => {
    await POST(req(), { params: params() })
    expect(h.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task1', theme: { type: { trainerId: 't1' } } },
      }),
    )
  })

  it('404s another business’s item without issuing a token', async () => {
    h.findFirst.mockResolvedValue(null)
    const res = await POST(req(), { params: params('someone-elses') })
    expect(res.status).toBe(404)
    expect(h.handleUpload).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    h.getTrainerContext.mockResolvedValue(null)
    const res = await POST(req(), { params: params() })
    expect(res.status).toBe(401)
    expect(h.handleUpload).not.toHaveBeenCalled()
  })

  it('refuses a staff member without the library permission', async () => {
    h.can.mockReturnValue(false)
    const res = await POST(req(), { params: params() })
    expect(res.status).toBe(403)
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.handleUpload).not.toHaveBeenCalled()
  })

  // The size is re-checked server-side: the client's claim is not a guard.
  it('caps the upload at 100 MB, whatever the client claims', async () => {
    await POST(req(), { params: params() })
    const onBefore = h.handleUpload.mock.calls[0][0].onBeforeGenerateToken
    await expect(onBefore('clip.mp4', JSON.stringify({ sizeBytes: 200 * 1024 * 1024 })))
      .rejects.toThrow(/100 MB/)
    await expect(onBefore('clip.mp4', JSON.stringify({ sizeBytes: 5 * 1024 * 1024 })))
      .resolves.toMatchObject({ maximumSizeInBytes: 100 * 1024 * 1024 })
  })
})
