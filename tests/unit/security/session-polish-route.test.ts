import { describe, it, expect, vi, beforeEach } from 'vitest'

// Security + scoping for the AI note-polish route:
// POST /api/sessions/[sessionId]/polish
//   - non-trainer rejected (401)
//   - cross-tenant session (findFirst scoped to trainerId finds nothing) → 404,
//     and the Anthropic client is never called (no token spend on a foreign id)
//   - a form belonging to another trainer → 404
//   - happy path returns the polished map
//
// The @anthropic-ai/sdk client is instantiated at module load, so it MUST be
// mocked or the import throws / makes a network call.

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  sessionFindFirst: vi.fn(),
  formFindFirst: vi.fn(),
  customFieldFindMany: vi.fn(),
  messagesCreate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainingSession: { findFirst: h.sessionFindFirst },
    sessionForm: { findFirst: h.formFindFirst },
    customField: { findMany: h.customFieldFindMany },
  },
}))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.messagesCreate }
  },
}))

import { POST } from '@/app/api/sessions/[sessionId]/polish/route'

const params = (sessionId: string) => ({ params: Promise.resolve({ sessionId }) })
function req(body: unknown) {
  return new Request('https://app.pupmanager.com/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 't1' } })
  h.sessionFindFirst.mockResolvedValue({ id: 's1', client: { user: { name: 'Sarah' } }, dog: { name: 'Bailey', breed: 'Lab' } })
  h.formFindFirst.mockResolvedValue({ id: 'f1', trainerId: 't1', questions: [{ id: 'q1', type: 'LONG_TEXT', label: 'Notes' }] })
  h.customFieldFindMany.mockResolvedValue([])
  h.messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: '{"q1":"Polished note."}' }] })
})

const body = { formId: 'f1', answers: { q1: 'gud boy did sit' } }

describe('POST polish — authz + tenant scoping', () => {
  it('401 when the caller is not a TRAINER', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await POST(req(body), params('s1'))
    expect(res.status).toBe(401)
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('401 when the trainer session has no trainerId', async () => {
    h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: null } })
    const res = await POST(req(body), params('s1'))
    expect(res.status).toBe(401)
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('404 (no AI call) for a cross-tenant / foreign session id', async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    const res = await POST(req(body), params('FOREIGN-session'))
    expect(res.status).toBe(404)
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('404 when the form belongs to another trainer', async () => {
    h.formFindFirst.mockResolvedValue(null) // findFirst scoped to trainerId
    const res = await POST(req(body), params('s1'))
    expect(res.status).toBe(404)
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('400 on an invalid body', async () => {
    const res = await POST(req({ formId: 'f1' }), params('s1')) // missing answers
    expect(res.status).toBe(400)
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('returns an empty map (no AI call) when there is nothing prose to polish', async () => {
    const res = await POST(req({ formId: 'f1', answers: { q1: '   ' } }), params('s1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ polished: {} })
    expect(h.messagesCreate).not.toHaveBeenCalled()
  })

  it('happy path: polishes prose answers and returns the map', async () => {
    const res = await POST(req(body), params('s1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ polished: { q1: 'Polished note.' } })
    expect(h.messagesCreate).toHaveBeenCalledTimes(1)
  })

  it('502 when the AI call throws', async () => {
    h.messagesCreate.mockRejectedValue(new Error('boom'))
    const res = await POST(req(body), params('s1'))
    expect(res.status).toBe(502)
  })
})
