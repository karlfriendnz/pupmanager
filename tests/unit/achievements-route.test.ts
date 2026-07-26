import { describe, it, expect, vi, beforeEach } from 'vitest'

// Achievements gained an uploaded badge image. These cover the route side: the
// URL round-trips, clearing it restores the emoji, junk is refused, and the
// tenant + permission guards still hold. Also pins the description cap, which
// was 500 while the field is Tiptap HTML — the same trap that made products
// unsaveable.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  trainerFindUnique: vi.fn(),
  achievementFindUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  evaluate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/achievements', () => ({ evaluateAchievementForAllClients: h.evaluate }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    achievement: {
      findUnique: h.achievementFindUnique,
      create: h.create,
      update: h.update,
      count: h.count,
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

import { POST } from '@/app/api/achievements/route'
import { PATCH } from '@/app/api/achievements/[achievementId]/route'

const TRAINER = 'trainer_1'
const ID = 'ach_1'

const post = (body: unknown) =>
  POST(new Request('https://app.pupmanager.com/api/achievements', {
    method: 'POST',
    body: JSON.stringify(body),
  }))

const patch = (body: unknown) =>
  PATCH(
    new Request(`https://app.pupmanager.com/api/achievements/${ID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ achievementId: ID }) }
  )

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.guardPermission.mockResolvedValue({ companyId: TRAINER, role: 'OWNER' })
  h.auth.mockResolvedValue({ user: { id: 'user_1', role: 'TRAINER', trainerId: TRAINER } })
  h.trainerFindUnique.mockResolvedValue({ id: TRAINER })
  h.achievementFindUnique.mockResolvedValue({
    id: ID, trainerId: TRAINER, triggerType: 'MANUAL', triggerValue: null,
  })
  h.count.mockResolvedValue(0)
  h.create.mockImplementation(({ data }: { data: object }) => ({ id: ID, ...data }))
  h.update.mockImplementation(({ data }: { data: object }) => ({ id: ID, triggerType: 'MANUAL', ...data }))
  h.evaluate.mockResolvedValue(undefined)
})

describe('achievement badge image', () => {
  it('POST stores an uploaded image URL', async () => {
    const url = 'https://blob.vercel-storage.com/trainer-images/x/badge.png'
    const res = await post({ name: 'Recall hero', imageUrl: url })
    expect(res.status).toBe(201)
    expect(h.create.mock.calls[0][0].data).toMatchObject({ imageUrl: url })
  })

  it('PATCH stores an uploaded image URL', async () => {
    const url = 'https://blob.vercel-storage.com/trainer-images/x/badge.png'
    const res = await patch({ imageUrl: url })
    expect(res.status).toBe(200)
    expect(h.update.mock.calls[0][0].data).toMatchObject({ imageUrl: url })
  })

  it('clearing the image restores the emoji — null, not an empty string', async () => {
    expect((await patch({ imageUrl: null })).status).toBe(200)
    expect(h.update.mock.calls[0][0].data).toMatchObject({ imageUrl: null })

    h.update.mockClear()
    expect((await patch({ imageUrl: '' })).status).toBe(200)
    expect(h.update.mock.calls[0][0].data).toMatchObject({ imageUrl: null })
  })

  it('refuses a javascript: URL — badges render as <img> in the client app', async () => {
    const res = await patch({ imageUrl: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('an achievement with no image is fine — the emoji stands in', async () => {
    const res = await post({ name: 'Manual badge', icon: '🐾' })
    expect(res.status).toBe(201)
    expect(h.create.mock.calls[0][0].data).toMatchObject({ imageUrl: null, icon: '🐾' })
  })

  it('a long rich-text description saves — the old 500-char cap rejected it', async () => {
    const html = `<p>${'Recall on a long line. '.repeat(60)}</p>`
    expect(html.length).toBeGreaterThan(500)
    expect((await patch({ description: html })).status).toBe(200)
  })
})

describe('achievement routes — tenant + permission guards', () => {
  it('PATCH 404s on another trainer’s achievement', async () => {
    h.achievementFindUnique.mockResolvedValue({ id: ID, trainerId: 'someone_else', triggerType: 'MANUAL' })
    const res = await patch({ imageUrl: 'https://blob.vercel-storage.com/x.png' })
    expect(res.status).toBe(404)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('POST refuses a session without achievements.manage', async () => {
    const { NextResponse } = await import('next/server')
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await post({ name: 'Nope' })
    expect(res.status).toBe(403)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('PATCH refuses a client session', async () => {
    h.auth.mockResolvedValue({ user: { id: 'user_2', role: 'CLIENT' } })
    const res = await patch({ name: 'Nope' })
    expect(res.status).toBe(401)
    expect(h.update).not.toHaveBeenCalled()
  })
})
