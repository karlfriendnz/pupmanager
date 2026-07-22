import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tenant guard: a form's auto-reply template id comes from the request body,
// so the route must prove it belongs to the form's own trainer. Otherwise one
// trainer could point their public form at another tenant's email copy and
// exfiltrate it to anyone who fills the form in.
const { mockAuth, mockGuard, mockFindFirstForm, mockFindFirstTemplate, mockUpdate, mockTrainer } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGuard: vi.fn(),
  mockFindFirstForm: vi.fn(),
  mockFindFirstTemplate: vi.fn(),
  mockUpdate: vi.fn(),
  mockTrainer: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/membership', () => ({ guardPermission: mockGuard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: mockTrainer },
    embedForm: { findFirst: mockFindFirstForm, update: mockUpdate },
    emailTemplate: { findFirst: mockFindFirstTemplate },
  },
}))

import { PATCH } from '@/app/api/embed-forms/[formId]/route'

const OWN_FORM = { id: 'form_1', trainerId: 'tr_me' }
const params = Promise.resolve({ formId: 'form_1' })
const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/embed-forms/form_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mockGuard.mockResolvedValue(undefined)
  mockAuth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u_me', trainerId: 'tr_me' } })
  mockTrainer.mockResolvedValue({ id: 'tr_me' })
  mockFindFirstForm.mockResolvedValue(OWN_FORM)
  mockUpdate.mockImplementation(async ({ data }) => ({ ...OWN_FORM, ...data }))
})

describe('PATCH /api/embed-forms/[formId] — auto-reply template ownership', () => {
  it("rejects a template id belonging to another trainer", async () => {
    mockFindFirstTemplate.mockResolvedValue(null) // not found *for this trainer*
    const res = await patch({ autoReplyMode: 'TEMPLATE', autoReplyTemplateId: 'tpl_other_tenant' })

    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
    // The lookup must be scoped to the form's trainer, not the request.
    expect(mockFindFirstTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tpl_other_tenant', trainerId: 'tr_me' } }),
    )
  })

  it('accepts a template the trainer owns', async () => {
    mockFindFirstTemplate.mockResolvedValue({ id: 'tpl_mine' })
    const res = await patch({ autoReplyMode: 'TEMPLATE', autoReplyTemplateId: 'tpl_mine' })

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ autoReplyMode: 'TEMPLATE', autoReplyTemplateId: 'tpl_mine' }),
      }),
    )
  })

  it('skips the lookup when no template id is supplied', async () => {
    const res = await patch({ autoReplyMode: 'CUSTOM', autoReplySubject: 'Hi', autoReplyBody: 'There' })

    expect(res.status).toBe(200)
    expect(mockFindFirstTemplate).not.toHaveBeenCalled()
  })

  it('rejects an unknown auto-reply mode', async () => {
    const res = await patch({ autoReplyMode: 'SEND_TO_EVERYONE' })
    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("404s on another trainer's form before touching anything", async () => {
    mockFindFirstForm.mockResolvedValue(null)
    const res = await patch({ autoReplyMode: 'OFF' })
    expect(res.status).toBe(404)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
