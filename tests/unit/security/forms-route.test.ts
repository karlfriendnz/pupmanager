import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Guards + tenant scoping on the unified Form API.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  formCreate: vi.fn(),
  formFindMany: vi.fn(),
  formFindUnique: vi.fn(),
  formUpdate: vi.fn(),
  formDelete: vi.fn(),
  customFieldFindMany: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    form: {
      create: h.formCreate,
      findMany: h.formFindMany,
      findUnique: h.formFindUnique,
      update: h.formUpdate,
      delete: h.formDelete,
    },
    customField: { findMany: h.customFieldFindMany },
  },
}))

import { POST, GET } from '@/app/api/forms/route'
import { PATCH, DELETE } from '@/app/api/forms/[formId]/route'

const OWNER = 'trainer-1'
const OTHER = 'trainer-2'

function post(body: unknown) {
  return POST(new Request('https://app.pupmanager.com/api/forms', { method: 'POST', body: JSON.stringify(body) }))
}
function patch(formId: string, body: unknown) {
  return PATCH(
    new Request(`https://app.pupmanager.com/api/forms/${formId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    { params: Promise.resolve({ formId }) },
  )
}
function del(formId: string) {
  return DELETE(
    new Request(`https://app.pupmanager.com/api/forms/${formId}`, { method: 'DELETE' }),
    { params: Promise.resolve({ formId }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: OWNER } })
  h.guardPermission.mockResolvedValue(undefined)
  h.formFindMany.mockResolvedValue([])
  h.customFieldFindMany.mockResolvedValue([])
  h.formFindUnique.mockResolvedValue({ id: 'f1', trainerId: OWNER, name: 'Grooming intake' })
  h.formCreate.mockImplementation(({ data }: { data: unknown }) => ({ id: 'f1', ...(data as object) }))
  h.formUpdate.mockImplementation(({ data }: { data: unknown }) => ({ id: 'f1', ...(data as object) }))
  h.formDelete.mockResolvedValue({ id: 'f1' })
})

const validBody = {
  name: 'Grooming intake',
  usableAsIntake: true,
  questions: [{ id: 'q1', type: 'SHORT_TEXT', label: 'Coat type', required: false }],
}

describe('POST /api/forms — guards', () => {
  it('rejects a signed-out / non-trainer caller', async () => {
    h.auth.mockResolvedValue(null)
    expect((await post(validBody)).status).toBe(401)
    expect(h.formCreate).not.toHaveBeenCalled()
  })

  it('rejects a team member without settings.edit', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await post(validBody)).status).toBe(403)
    expect(h.formCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/forms — validation + tenant scoping', () => {
  it('rejects an empty / question-less form', async () => {
    expect((await post({ name: '', questions: [] })).status).toBe(400)
  })

  it("writes to the CALLER's trainer, never a body-supplied one", async () => {
    await post({ ...validBody, trainerId: OTHER })
    expect(h.formCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trainerId: OWNER }) }),
    )
  })

  it('refuses a CUSTOM_FIELD question referencing a field the trainer does not own', async () => {
    h.customFieldFindMany.mockResolvedValue([]) // owns nothing
    const res = await post({
      name: 'x',
      usableAsIntake: true,
      questions: [{ id: 'q1', type: 'CUSTOM_FIELD', customFieldId: 'someone-elses-field', required: false }],
    })
    expect(res.status).toBe(400)
    expect(h.formCreate).not.toHaveBeenCalled()
  })

  it('scopes the linked-field ownership check to the caller', async () => {
    h.customFieldFindMany.mockResolvedValue([{ id: 'cf1' }])
    await post({
      name: 'x',
      usableAsIntake: true,
      questions: [{ id: 'q1', type: 'CUSTOM_FIELD', customFieldId: 'cf1', required: false }],
    })
    expect(h.customFieldFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ trainerId: OWNER }) }),
    )
  })

  it('only gives an enquiry form a public slug', async () => {
    await post({ ...validBody, usableAsIntake: false, usableAsEnquiry: true })
    expect(h.formCreate.mock.calls[0][0].data.slug).toBe('grooming-intake')
    await post(validBody) // intake-only
    expect(h.formCreate.mock.calls[1][0].data.slug).toBeNull()
  })
})

describe('GET /api/forms', () => {
  it("lists only the caller's forms", async () => {
    await GET()
    expect(h.formFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { trainerId: OWNER } }))
  })

  it('rejects a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})

describe('PATCH / DELETE /api/forms/[formId] — cross-tenant', () => {
  it("404s on another trainer's form rather than editing it", async () => {
    h.formFindUnique.mockResolvedValue({ id: 'f1', trainerId: OTHER, name: 'Theirs' })
    expect((await patch('f1', { name: 'hijacked' })).status).toBe(404)
    expect(h.formUpdate).not.toHaveBeenCalled()
  })

  it("404s on deleting another trainer's form", async () => {
    h.formFindUnique.mockResolvedValue({ id: 'f1', trainerId: OTHER, name: 'Theirs' })
    expect((await del('f1')).status).toBe(404)
    expect(h.formDelete).not.toHaveBeenCalled()
  })

  it('requires settings.edit to delete', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await del('f1')).status).toBe(403)
    expect(h.formDelete).not.toHaveBeenCalled()
  })

  it('leaves the slug alone on a publish-only PATCH', async () => {
    await patch('f1', { isActive: false })
    expect(h.formUpdate.mock.calls[0][0].data).not.toHaveProperty('slug')
  })

  it('clears the slug when a form stops being an enquiry form', async () => {
    await patch('f1', { usableAsEnquiry: false })
    expect(h.formUpdate.mock.calls[0][0].data.slug).toBeNull()
  })
})
