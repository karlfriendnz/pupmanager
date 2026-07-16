import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/tasks/logs/[logId]/comment — a TRAINER replies to a client's
// practice log. Guards under test:
//   - only a signed-in TRAINER may comment (clients / anon rejected)
//   - the trainer must be a MEMBER of the company that owns the log's client;
//     a non-member gets 404 and nothing is written
//   - on success the comment is saved AND the client is notified
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  logFindUnique: vi.fn(),
  logUpdate: vi.fn(),
  membershipFindFirst: vi.fn(),
  notifyClient: vi.fn(),
  notifyTrainer: vi.fn(),
  safeEvaluate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingLog: { findUnique: h.logFindUnique, update: h.logUpdate },
    trainerMembership: { findFirst: h.membershipFindFirst },
  },
}))
vi.mock('@/lib/trainer-notify', () => ({ notifyTrainer: h.notifyTrainer }))
vi.mock('@/lib/client-notify', () => ({ notifyClient: h.notifyClient }))
vi.mock('@/lib/achievements', () => ({ safeEvaluate: h.safeEvaluate }))

import { POST } from '@/app/api/tasks/logs/[logId]/comment/route'

function req(body: unknown): Request {
  return new Request('https://app.pupmanager.com/api/tasks/logs/log-1/comment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const ctx = (logId = 'log-1') => ({ params: Promise.resolve({ logId }) })

const LOG = {
  id: 'log-1',
  task: {
    id: 't1',
    title: 'Loose-lead walking',
    client: {
      userId: 'client-user',
      trainerId: 'company-1',
      trainer: { businessName: 'Happy Paws', user: { name: 'Jess' } },
    },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'trainer-user', role: 'TRAINER' } })
  h.logFindUnique.mockResolvedValue(LOG)
  h.membershipFindFirst.mockResolvedValue({ id: 'm-1' }) // member by default
  h.logUpdate.mockResolvedValue({ id: 'log-1', trainerComment: 'Great work!', trainerCommentAt: new Date() })
})

describe('POST /api/tasks/logs/[logId]/comment — auth + tenancy', () => {
  it('rejects an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await POST(req({ comment: 'nice' }), ctx())
    expect(res.status).toBe(401)
    expect(h.logUpdate).not.toHaveBeenCalled()
  })

  it('rejects a non-trainer (a client cannot comment on their own log this way)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'client-user', role: 'CLIENT' } })
    const res = await POST(req({ comment: 'nice' }), ctx())
    expect(res.status).toBe(401)
    expect(h.logUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty comment', async () => {
    const res = await POST(req({ comment: '   ' }), ctx())
    expect(res.status).toBe(400)
    expect(h.logUpdate).not.toHaveBeenCalled()
  })

  it('404s a trainer who is NOT a member of the log’s client company, writing nothing', async () => {
    h.membershipFindFirst.mockResolvedValue(null) // outsider
    const res = await POST(req({ comment: 'sneaky' }), ctx())
    expect(res.status).toBe(404)
    expect(h.logUpdate).not.toHaveBeenCalled()
    expect(h.notifyClient).not.toHaveBeenCalled()
    // The membership check really did pin the acting user + the client's company.
    expect(h.membershipFindFirst.mock.calls[0][0].where).toMatchObject({
      userId: 'trainer-user',
      companyId: 'company-1',
    })
  })

  it('404s when the log does not exist', async () => {
    h.logFindUnique.mockResolvedValue(null)
    const res = await POST(req({ comment: 'nice' }), ctx('missing'))
    expect(res.status).toBe(404)
    expect(h.logUpdate).not.toHaveBeenCalled()
  })
})

describe('POST /api/tasks/logs/[logId]/comment — success', () => {
  it('saves the comment and notifies the client', async () => {
    const res = await POST(req({ comment: 'Great work!' }), ctx())
    expect(res.status).toBe(200)
    // The comment + a timestamp are written to the log.
    expect(h.logUpdate).toHaveBeenCalledTimes(1)
    const updateArg = h.logUpdate.mock.calls[0][0]
    expect(updateArg.where).toEqual({ id: 'log-1' })
    expect(updateArg.data.trainerComment).toBe('Great work!')
    expect(updateArg.data.trainerCommentAt).toBeInstanceOf(Date)
    // The client is notified with the trainer-comment type, branded to the company.
    expect(h.notifyClient).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'client-user',
      trainerId: 'company-1',
      type: 'TRAINER_COMMENTED_LOG',
      vars: expect.objectContaining({ trainerName: 'Happy Paws', taskTitle: 'Loose-lead walking' }),
      link: '/my-homework/t1',
    }))
  })
})
