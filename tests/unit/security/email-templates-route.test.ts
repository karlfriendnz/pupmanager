import { describe, it, expect, vi, beforeEach } from 'vitest'

// Authz + tenant-scoping for the trainer-owned email-template CRUD routes.
// Every mutation is scoped by trainerId (the company/tenant key on the session),
// so a trainer can only touch their own templates. Edits/deletes use
// updateMany/deleteMany with {id, trainerId}: a row owned by another company
// matches nothing → 404 and zero mutation.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteMany: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailTemplate: {
      findMany: h.findMany,
      create: h.create,
      updateMany: h.updateMany,
      deleteMany: h.deleteMany,
      findUnique: h.findUnique,
    },
  },
}))

import { GET, POST } from '@/app/api/email-templates/route'
import { PATCH, DELETE } from '@/app/api/email-templates/[id]/route'

const TRAINER = { user: { role: 'TRAINER', id: 'u1', trainerId: 'co1' } }
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })
const jsonReq = (body: unknown, method = 'POST') =>
  new Request('https://app.pupmanager.com/api/email-templates', {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.findMany.mockResolvedValue([])
  h.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 't', ...data }))
  h.findUnique.mockResolvedValue({ id: 't' })
})

describe('email-templates — authentication & role gating', () => {
  it('GET returns 401 for a non-trainer session', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await GET()
    expect(res.status).toBe(401)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('GET returns 401 for an unauthenticated request', async () => {
    h.auth.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it('POST returns 401 for a trainer with no trainerId (no company scope)', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: null } })
    const res = await POST(jsonReq({ name: 'n', subject: 's', body: 'b' }))
    expect(res.status).toBe(401)
    expect(h.create).not.toHaveBeenCalled()
  })

  it('GET scopes the list to the signed-in trainer only', async () => {
    h.auth.mockResolvedValue(TRAINER)
    await GET()
    expect(h.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { trainerId: 'co1' } }))
  })
})

describe('email-templates — create stamps the caller as owner', () => {
  it('POST persists the template under the caller trainerId', async () => {
    h.auth.mockResolvedValue(TRAINER)
    const res = await POST(jsonReq({ name: 'Welcome', subject: 'Hi', body: '<p>Hello</p>' }))
    expect(res.status).toBe(200)
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ trainerId: 'co1', name: 'Welcome' }),
    }))
  })

  it('POST rejects invalid input (empty body) with 400', async () => {
    h.auth.mockResolvedValue(TRAINER)
    const res = await POST(jsonReq({ name: 'n', subject: 's', body: '' }))
    expect(res.status).toBe(400)
    expect(h.create).not.toHaveBeenCalled()
  })
})

describe('email-templates — cross-tenant edit/delete guard', () => {
  it('PATCH on another company’s template → 404 and no follow-up read', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.updateMany.mockResolvedValue({ count: 0 }) // {id, trainerId:co1} matched nothing → foreign row
    const res = await PATCH(jsonReq({ name: 'pwned' }, 'PATCH'), idParams('FOREIGN'))
    expect(res.status).toBe(404)
    // Scoped by trainerId, so the attacker's company can never match a foreign row.
    expect(h.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'FOREIGN', trainerId: 'co1' },
    }))
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('DELETE on another company’s template → 404 and nothing removed', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.deleteMany.mockResolvedValue({ count: 0 })
    const res = await DELETE(jsonReq({}, 'DELETE'), idParams('FOREIGN'))
    expect(res.status).toBe(404)
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { id: 'FOREIGN', trainerId: 'co1' } })
  })

  it('PATCH succeeds (200) for an owned template', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.updateMany.mockResolvedValue({ count: 1 })
    const res = await PATCH(jsonReq({ name: 'New name' }, 'PATCH'), idParams('owned'))
    expect(res.status).toBe(200)
  })

  it('DELETE succeeds for an owned template', async () => {
    h.auth.mockResolvedValue(TRAINER)
    h.deleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(jsonReq({}, 'DELETE'), idParams('owned'))
    expect(res.status).toBe(200)
  })

  it('PATCH/DELETE reject a non-trainer with 401 before any DB call', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    expect((await PATCH(jsonReq({ name: 'x' }, 'PATCH'), idParams('t'))).status).toBe(401)
    expect((await DELETE(jsonReq({}, 'DELETE'), idParams('t'))).status).toBe(401)
    expect(h.updateMany).not.toHaveBeenCalled()
    expect(h.deleteMany).not.toHaveBeenCalled()
  })
})

describe('email-templates — template body sanitisation posture (FINDING)', () => {
  // The create/update routes do NOT sanitise the HTML body before storage; the
  // raw body is persisted. Sanitisation happens later at render/send time via
  // emailBodyToHtml (proven in messages-email-route.test.ts). This test pins the
  // current behaviour so it's a deliberate, reviewed decision rather than a
  // silent assumption.
  it('stores the body RAW — a <script> survives into storage (sanitised only at send)', async () => {
    h.auth.mockResolvedValue(TRAINER)
    const evil = '<p>Hi</p><script>steal()</script>'
    await POST(jsonReq({ name: 'n', subject: 's', body: evil }))
    const stored = h.create.mock.calls[0][0].data.body
    expect(stored).toBe(evil) // NOT sanitised at the storage boundary
    expect(stored).toContain('<script>')
  })
})
