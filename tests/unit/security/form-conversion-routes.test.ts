import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tenant guards on the two conversion routes.
 *
 * Both build a NEW form out of rows that already exist, which makes them a
 * copying machine — exactly the thing that must never read across a tenant
 * boundary. The embed one takes its id straight off the URL, and both end up
 * linking CustomFields by id, so what is asserted here is that every read is
 * scoped to the caller's own trainer and that nothing is written when it isn't.
 */
const { mockAuth, mockGuard, mockFieldFindMany, mockFormCreate, mockFormFindMany, mockEmbedFindFirst } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockGuard: vi.fn(),
    mockFieldFindMany: vi.fn(),
    mockFormCreate: vi.fn(),
    mockFormFindMany: vi.fn(),
    mockEmbedFindFirst: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({ auth: mockAuth }))
vi.mock('@/lib/membership', () => ({ guardPermission: mockGuard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    customField: { findMany: mockFieldFindMany },
    form: { create: mockFormCreate, findMany: mockFormFindMany },
    embedForm: { findFirst: mockEmbedFindFirst },
  },
}))

import { POST as fromFields } from '@/app/api/forms/from-fields/route'
import { POST as embedToForm } from '@/app/api/embed-forms/[formId]/to-form/route'

const embedReq = () => new Request('http://localhost/api/embed-forms/ef_1/to-form', { method: 'POST' })
const params = { params: Promise.resolve({ formId: 'ef_1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockGuard.mockResolvedValue(undefined)
  mockAuth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u_me', trainerId: 'tr_me' } })
  mockFormCreate.mockImplementation(async () => ({ id: 'form_new' }))
  mockFormFindMany.mockResolvedValue([])
})

describe('POST /api/forms/from-fields', () => {
  it('reads only the caller’s own fields', async () => {
    mockFieldFindMany.mockResolvedValue([{ id: 'f1', required: true, appliesTo: 'OWNER' }])
    const res = await fromFields()

    expect(res.status).toBe(201)
    // The ids never come from the browser at all — they are whatever this
    // trainer's own library holds.
    expect(mockFieldFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: 'tr_me' } }),
    )
    expect(mockFormCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ trainerId: 'tr_me' }) }),
    )
  })

  it('refuses, and writes nothing, when there are no fields to convert', async () => {
    mockFieldFindMany.mockResolvedValue([])
    const res = await fromFields()

    expect(res.status).toBe(400)
    // An empty form is not a form — Form.questions has a min(1) on the API, so
    // creating one here would make a row the editor could never save again.
    expect(mockFormCreate).not.toHaveBeenCalled()
  })

  it('creates the form as a draft, not published', async () => {
    mockFieldFindMany.mockResolvedValue([{ id: 'f1', required: false, appliesTo: 'OWNER' }])
    await fromFields()
    // Pressing "turn into a form" must not start asking every new client a set
    // of questions the trainer has not looked at yet.
    expect(mockFormCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false, usableAsIntake: true }) }),
    )
  })

  it('rejects a caller with no trainer', async () => {
    mockAuth.mockResolvedValue({ user: { role: 'CLIENT', id: 'u_x' } })
    const res = await fromFields()
    expect(res.status).toBe(401)
    expect(mockFormCreate).not.toHaveBeenCalled()
  })
})

describe('POST /api/embed-forms/[formId]/to-form', () => {
  const OWN_EMBED = {
    id: 'ef_1',
    trainerId: 'tr_me',
    title: 'Get in touch',
    description: null,
    fields: [{ key: 'phone', required: true }],
    customFieldIds: ['cf1'],
    thankYouTitle: 'Thanks!',
    thankYouMessage: 'We will be in touch.',
    showBorder: true,
    buttonColor: '#2563eb',
  }

  it('404s on another trainer’s form and copies nothing', async () => {
    mockEmbedFindFirst.mockResolvedValue(null) // not found *for this trainer*
    const res = await embedToForm(embedReq(), params)

    expect(res.status).toBe(404)
    expect(mockFormCreate).not.toHaveBeenCalled()
    // Scoped by trainerId, never findUnique on the id alone — the id is off a URL.
    expect(mockEmbedFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ef_1', trainerId: 'tr_me' } }),
    )
  })

  it('re-checks every linked field id against the caller’s own fields', async () => {
    mockEmbedFindFirst.mockResolvedValue(OWN_EMBED)
    mockFieldFindMany.mockResolvedValue([{ id: 'cf1', required: true }])
    const res = await embedToForm(embedReq(), params)

    expect(res.status).toBe(201)
    expect(mockFieldFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { trainerId: 'tr_me', id: { in: ['cf1'] } } }),
    )
  })

  it('drops a linked id whose field no longer exists', async () => {
    mockEmbedFindFirst.mockResolvedValue({ ...OWN_EMBED, customFieldIds: ['cf1', 'cf_deleted'] })
    mockFieldFindMany.mockResolvedValue([{ id: 'cf1', required: false }])
    const res = await embedToForm(embedReq(), params)
    const body = await res.json()

    // A stale id would otherwise become a question rendering as a blank box
    // with no label, which nobody can answer and nothing can store.
    expect(body.droppedLinkedFields).toBe(1)
    const created = mockFormCreate.mock.calls[0][0].data.questions
    expect(created.some((q: { customFieldId?: string }) => q.customFieldId === 'cf_deleted')).toBe(false)
  })

  it('leaves the embed form completely untouched', async () => {
    mockEmbedFindFirst.mockResolvedValue(OWN_EMBED)
    mockFieldFindMany.mockResolvedValue([{ id: 'cf1', required: false }])
    const res = await embedToForm(embedReq(), params)

    // It is live inside an <iframe> on the trainer's website that this route has
    // no way to update. Disabling it here would take a working enquiry form off
    // their site without warning.
    //
    // The proof is structural rather than an assertion on a spy: the prisma mock
    // above gives embedForm a `findFirst` and NOTHING ELSE, so any update or
    // delete the route attempted would throw "not a function" and fail here. A
    // 201 means it only ever read.
    expect(res.status).toBe(201)
    expect(mockFormCreate).toHaveBeenCalledTimes(1)
  })

  it('carries the branding and thank-you copy across, as a draft', async () => {
    mockEmbedFindFirst.mockResolvedValue(OWN_EMBED)
    mockFieldFindMany.mockResolvedValue([{ id: 'cf1', required: false }])
    await embedToForm(embedReq(), params)

    expect(mockFormCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trainerId: 'tr_me',
          name: 'Get in touch',
          thankYouTitle: 'Thanks!',
          thankYouMessage: 'We will be in touch.',
          showBorder: true,
          buttonColor: '#2563eb',
          usableAsEnquiry: true,
          isActive: false,
        }),
      }),
    )
  })
})
