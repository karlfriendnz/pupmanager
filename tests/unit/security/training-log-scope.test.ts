import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/tasks/[taskId]/logs — a client logs a practice record against a
// homework task. Guards under test:
//   - only a signed-in CLIENT may log
//   - the task must belong to one of THAT user's own client profiles (a client
//     can never log against another client's task)
//   - an empty log is rejected
//   - the FIRST log flips the task's completion (and only the first notifies)
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  taskFindFirst: vi.fn(),
  taskCount: vi.fn(),
  completionFindUnique: vi.fn(),
  completionUpsert: vi.fn(),
  completionCount: vi.fn(),
  logCreate: vi.fn(),
  clientProfileFindUnique: vi.fn(),
  safeEvaluate: vi.fn(),
  notifyTrainer: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingTask: { findFirst: h.taskFindFirst, count: h.taskCount },
    taskCompletion: { findUnique: h.completionFindUnique, upsert: h.completionUpsert, count: h.completionCount },
    trainingLog: { create: h.logCreate },
    clientProfile: { findUnique: h.clientProfileFindUnique },
  },
}))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))

import { POST } from '@/app/api/tasks/[taskId]/logs/route'

function req(body: unknown): Request {
  return new Request('https://app.pupmanager.com/api/tasks/t1/logs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const ctx = (taskId = 't1') => ({ params: Promise.resolve({ taskId }) })

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'user-1', role: 'CLIENT' } })
  // The task lookup now carries the client + trainer routing inline (title,
  // name, dog, owner/assigned trainer) so both notification paths reuse it.
  h.taskFindFirst.mockResolvedValue({
    id: 't1',
    clientId: 'cp-1',
    title: 'Loose-lead walking',
    client: {
      trainerId: 'trainer-1',
      user: { name: 'Karl' },
      dog: { name: 'Biscuit' },
      trainer: { user: { id: 'owner-user' } },
      assignedTrainer: null,
    },
  })
  h.completionFindUnique.mockResolvedValue(null) // not yet complete
  h.completionUpsert.mockResolvedValue({})
  h.logCreate.mockResolvedValue({ id: 'log-1', loggedAt: new Date(), note: 'went well', repsDone: 10, rating: 3, imageUrls: [] })
  h.taskCount.mockResolvedValue(2)
  h.completionCount.mockResolvedValue(1) // not all done → no notify by default
  h.safeEvaluate.mockResolvedValue(undefined)
})

describe('POST /api/tasks/[taskId]/logs — auth + ownership', () => {
  it('rejects an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req({ note: 'x' }), ctx())
    expect(res.status).toBe(401)
    expect(h.logCreate).not.toHaveBeenCalled()
  })

  it('rejects a non-client (e.g. a trainer)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user-1', role: 'TRAINER' } })
    const res = await POST(req({ note: 'x' }), ctx())
    expect(res.status).toBe(401)
    expect(h.logCreate).not.toHaveBeenCalled()
  })

  it("never logs against another client's task", async () => {
    // The scope query is { id, client: { userId } }; a task that isn't this
    // user's returns null → 404, and nothing is written.
    h.taskFindFirst.mockResolvedValue(null)
    const res = await POST(req({ note: 'x' }), ctx('someone-elses-task'))
    expect(res.status).toBe(404)
    expect(h.logCreate).not.toHaveBeenCalled()
    // The ownership filter really did pin the signed-in user's id.
    expect(h.taskFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 'someone-elses-task',
      client: { userId: 'user-1' },
    })
  })

  it('rejects an empty log (no note, reps, rating or video)', async () => {
    const res = await POST(req({}), ctx())
    expect(res.status).toBe(400)
    expect(h.logCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/tasks/[taskId]/logs — logging + completion side-effects', () => {
  it('creates the log and, on the FIRST log, marks the task done + re-evaluates achievements', async () => {
    const res = await POST(req({ note: 'went well', repsDone: 10, rating: 3 }), ctx())
    expect(res.status).toBe(200)
    expect(h.logCreate).toHaveBeenCalledWith({
      data: { taskId: 't1', note: 'went well', repsDone: 10, rating: 3, videoUrl: null, imageUrls: [] },
    })
    expect(h.completionUpsert).toHaveBeenCalledWith({ where: { taskId: 't1' }, create: { taskId: 't1' }, update: {} })
    expect(h.safeEvaluate).toHaveBeenCalledWith('cp-1')
  })

  it('notifies the trainer with CLIENT_LOGGED_TRAINING on EVERY log', async () => {
    await POST(req({ note: 'went well', rating: 3 }), ctx())
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'owner-user',
      'CLIENT_LOGGED_TRAINING',
      expect.objectContaining({ clientName: 'Karl', dogName: 'Biscuit', taskTitle: 'Loose-lead walking' }),
      '/clients/cp-1',
      'trainer-1',
    )
  })

  it('stores the attached imageUrls on the log', async () => {
    const imgs = ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']
    const res = await POST(req({ imageUrls: imgs }), ctx()) // photo-only log is valid
    expect(res.status).toBe(200)
    expect(h.logCreate).toHaveBeenCalledWith({
      data: { taskId: 't1', note: null, repsDone: null, rating: null, videoUrl: null, imageUrls: imgs },
    })
  })

  it('re-logs against an already-done task, still nudging the trainer but not the all-done milestone', async () => {
    h.completionFindUnique.mockResolvedValue({ taskId: 't1' }) // already complete
    const res = await POST(req({ note: 'more practice' }), ctx())
    expect(res.status).toBe(200)
    expect(h.logCreate).toHaveBeenCalled() // the extra log still records
    expect(h.completionUpsert).not.toHaveBeenCalled()
    // The per-log nudge still fires…
    expect(h.notifyTrainer).toHaveBeenCalledWith('owner-user', 'CLIENT_LOGGED_TRAINING', expect.anything(), '/clients/cp-1', 'trainer-1')
    // …but the all-done milestone does NOT (task was already complete).
    expect(h.notifyTrainer).not.toHaveBeenCalledWith('owner-user', 'CLIENT_COMPLETED_TASKS', expect.anything(), expect.anything(), expect.anything())
  })

  it('notifies the trainer when this log clears the client’s whole task list', async () => {
    h.completionCount.mockResolvedValue(2) // now 2 of 2 done — trainer routing comes from the task select
    await POST(req({ rating: 3 }), ctx())
    expect(h.notifyTrainer).toHaveBeenCalledWith(
      'owner-user',
      'CLIENT_COMPLETED_TASKS',
      expect.objectContaining({ clientName: 'Karl', taskCount: '2' }),
      '/clients/cp-1',
      'trainer-1',
    )
  })
})
