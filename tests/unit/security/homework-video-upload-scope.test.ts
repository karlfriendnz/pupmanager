import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/tasks/[taskId]/video-upload — issues a Vercel Blob client-upload
// token for a client's homework-log video. Guards under test:
//   - only a signed-in CLIENT may get a token
//   - the task must belong to one of THAT user's own client profiles
//   - the Blob handshake (handleUpload) only runs once those pass
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  taskFindFirst: vi.fn(),
  handleUpload: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({ prisma: { trainingTask: { findFirst: h.taskFindFirst } } }))
vi.mock('@vercel/blob/client', () => ({ handleUpload: h.handleUpload }))

import { POST } from '@/app/api/tasks/[taskId]/video-upload/route'

function req(body: unknown = { type: 'blob.generate-client-token' }): Request {
  return new Request('https://app.pupmanager.com/api/tasks/t1/video-upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const ctx = (taskId = 't1') => ({ params: Promise.resolve({ taskId }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'user-1', role: 'CLIENT' } })
  h.taskFindFirst.mockResolvedValue({ id: 't1' })
  h.handleUpload.mockResolvedValue({ ok: true })
})

describe('POST /api/tasks/[taskId]/video-upload — auth + ownership', () => {
  it('rejects an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req(), ctx())
    expect(res.status).toBe(401)
    expect(h.handleUpload).not.toHaveBeenCalled()
  })

  it('rejects a non-client (e.g. a trainer)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1', role: 'TRAINER' } })
    const res = await POST(req(), ctx())
    expect(res.status).toBe(401)
    expect(h.handleUpload).not.toHaveBeenCalled()
  })

  it("won't issue a token for a task that isn't the caller's", async () => {
    h.taskFindFirst.mockResolvedValue(null)
    const res = await POST(req(), ctx('someone-elses-task'))
    expect(res.status).toBe(404)
    expect(h.handleUpload).not.toHaveBeenCalled()
    // The ownership filter pinned the signed-in user's id.
    expect(h.taskFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 'someone-elses-task',
      client: { userId: 'user-1' },
    })
  })

  it('runs the Blob handshake once auth + ownership pass', async () => {
    const res = await POST(req(), ctx())
    expect(res.status).toBe(200)
    expect(h.handleUpload).toHaveBeenCalledTimes(1)
  })
})
