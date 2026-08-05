import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// The Form-scoped flow CRUD — the fourth parent a CommsFlowStep can hang off,
// and the first one whose ORDER is behaviour rather than decoration.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  formFindFirst: vi.fn(),
  stepFindMany: vi.fn(),
  stepFindFirst: vi.fn(),
  stepCreate: vi.fn(),
  stepUpdate: vi.fn(),
  stepDelete: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    form: { findFirst: h.formFindFirst },
    commsFlowStep: {
      findMany: h.stepFindMany,
      findFirst: h.stepFindFirst,
      create: h.stepCreate,
      update: h.stepUpdate,
      delete: h.stepDelete,
    },
    $transaction: h.transaction,
  },
}))

import { GET, POST } from '@/app/api/trainer/forms/[formId]/comms-flow/route'
import { PATCH, DELETE } from '@/app/api/trainer/forms/[formId]/comms-flow/[stepId]/route'
import { POST as REORDER } from '@/app/api/trainer/forms/[formId]/comms-flow/reorder/route'

const TRAINER = 'trainer-1'
const params = <T extends Record<string, string>>(over?: T) =>
  Promise.resolve({ formId: 'form-1', ...(over ?? ({} as T)) })

function req(body: unknown = {}): Request {
  return new Request('https://app.pupmanager.com/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  h.guard.mockResolvedValue({ companyId: TRAINER })
  h.formFindFirst.mockResolvedValue({ id: 'form-1' })
  h.stepFindMany.mockResolvedValue([])
  h.stepFindFirst.mockResolvedValue(null)
  h.stepCreate.mockImplementation(async ({ data }: { data: object }) => ({ id: 'new', ...data }))
  h.stepUpdate.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) => ({ id: where.id, ...data }))
  h.transaction.mockResolvedValue([])
})

describe('tenancy — a form flow is only ever the owner’s', () => {
  it('GET 404s a form that is not this trainer’s', async () => {
    h.formFindFirst.mockResolvedValue(null)
    const res = await GET(new Request('https://x/'), { params: params() })
    expect(res.status).toBe(404)
    expect(h.stepFindMany).not.toHaveBeenCalled()
  })

  it('GET scopes the lookup by trainerId, not just by form id', async () => {
    await GET(new Request('https://x/'), { params: params() })
    expect(h.formFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'form-1', trainerId: TRAINER } }),
    )
  })

  it('POST refuses without the permission', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await POST(req({}), { params: params() })
    expect(res.status).toBe(403)
    expect(h.stepCreate).not.toHaveBeenCalled()
  })

  it('PATCH matches the step through the form’s trainer, so a stolen id 404s', async () => {
    const res = await PATCH(req({ enabled: false }), { params: params({ stepId: 's1' }) })
    expect(res.status).toBe(404)
    expect(h.stepUpdate).not.toHaveBeenCalled()
    // The ownership filter reaches the form, not just the step.
    expect(h.stepFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', formId: 'form-1', form: { trainerId: TRAINER } } }),
    )
  })

  it('DELETE 404s a step that is not under this form', async () => {
    const res = await DELETE(new Request('https://x/'), { params: params({ stepId: 's1' }) })
    expect(res.status).toBe(404)
    expect(h.stepDelete).not.toHaveBeenCalled()
  })
})

describe('a journey’s steps are person-anchored, always', () => {
  it('POST forces a person trigger so the cron never picks the step up', async () => {
    const res = await POST(req({ kind: 'FORM' }), { params: params() })
    expect(res.status).toBe(201)
    const data = h.stepCreate.mock.calls[0][0].data
    expect(data.trigger).toBe('ON_ENQUIRY_SUBMITTED')
    expect(data.formId).toBe('form-1')
  })

  it('POST refuses a clock trigger posted from the browser outright', async () => {
    // personTriggerEnum is the whole allow-list: the four clock triggers live
    // in `direction` and writing one here would be the same fact in two columns.
    const res = await POST(req({ kind: 'MESSAGE', trigger: 'BEFORE_SESSION' }), { params: params() })
    expect(res.status).toBe(400)
    expect(h.stepCreate).not.toHaveBeenCalled()
  })

  it('POST accepts the other two person triggers', async () => {
    await POST(req({ kind: 'MESSAGE', trigger: 'ON_BOOKING' }), { params: params() })
    expect(h.stepCreate.mock.calls[0][0].data.trigger).toBe('ON_BOOKING')
  })

  it('PATCH cannot clear the trigger back to null', async () => {
    h.stepFindFirst.mockResolvedValue({ id: 's1', audience: 'CUSTOM', channels: ['PUSH'] })
    await PATCH(req({ trigger: null, enabled: false }), { params: params({ stepId: 's1' }) })
    const data = h.stepUpdate.mock.calls[0][0].data
    expect('trigger' in data).toBe(false)
    expect(data.enabled).toBe(false)
  })

  it('a new step lands at the end of the list', async () => {
    h.stepFindMany.mockResolvedValue([])
    h.stepFindFirst.mockResolvedValue(null)
    // findFirst is used both for ownership (form) and for the last order; the
    // route reads the order off commsFlowStep.findFirst.
    h.stepFindFirst.mockResolvedValueOnce({ order: 4 })
    await POST(req({}), { params: params() })
    expect(h.stepCreate.mock.calls[0][0].data.order).toBe(5)
  })
})

describe('reorder — the order IS the behaviour, so it is persisted', () => {
  it('writes one update per id, in the order given', async () => {
    h.stepFindMany.mockResolvedValueOnce([{ id: 'b' }, { id: 'a' }, { id: 'c' }])
    h.stepFindMany.mockResolvedValueOnce([])
    const res = await REORDER(req({ ids: ['c', 'a', 'b'] }), { params: params() })
    expect(res.status).toBe(200)

    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.stepUpdate.mock.calls.map(c => [c[0].where.id, c[0].data.order])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ])
  })

  it('refuses when an id is not a step of this form', async () => {
    // Only two of the three posted ids came back as owned.
    h.stepFindMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
    const res = await REORDER(req({ ids: ['a', 'b', 'someone-elses'] }), { params: params() })
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('404s a form the trainer does not own before reading any step', async () => {
    h.formFindFirst.mockResolvedValue(null)
    const res = await REORDER(req({ ids: ['a'] }), { params: params() })
    expect(res.status).toBe(404)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('rejects an empty list rather than wiping the order', async () => {
    const res = await REORDER(req({ ids: [] }), { params: params() })
    expect(res.status).toBe(400)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('hands back the saved list so a reload shows what the drag left', async () => {
    h.stepFindMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
    h.stepFindMany.mockResolvedValueOnce([{ id: 'b', order: 0 }, { id: 'a', order: 1 }])
    const res = await REORDER(req({ ids: ['b', 'a'] }), { params: params() })
    expect(await res.json()).toEqual([{ id: 'b', order: 0 }, { id: 'a', order: 1 }])
  })
})

// A wall only comes down when a FlowStepCompletion is written, and today only
// the ACCOUNT step gets one. A blocking step of any other kind would not
// "wait" — it would park every person on it for ever, with nobody told.
describe('a step nothing can tick off cannot be made to wait', () => {
  it('POST refuses to create a blocking FORM step, however it was asked for', async () => {
    await POST(req({ kind: 'FORM', blocking: true }), { params: params() })
    expect(h.stepCreate.mock.calls[0][0].data.blocking).toBe(false)
  })

  it('POST keeps an ACCOUNT step blocking — that one really is a wall', async () => {
    await POST(req({ kind: 'ACCOUNT' }), { params: params() })
    expect(h.stepCreate.mock.calls[0][0].data.blocking).toBe(true)
  })

  it('a MESSAGE never blocks — there is nothing to wait for', async () => {
    await POST(req({ kind: 'MESSAGE', blocking: true }), { params: params() })
    expect(h.stepCreate.mock.calls[0][0].data.blocking).toBe(false)
  })

  it('PATCH strips it too — the browser hiding the toggle is not the check', async () => {
    h.stepFindFirst.mockResolvedValue({ id: 's1', audience: 'CUSTOM', channels: ['PUSH'], kind: 'UPLOAD' })
    await PATCH(req({ blocking: true }), { params: params({ stepId: 's1' }) })
    expect(h.stepUpdate.mock.calls[0][0].data.blocking).toBe(false)
  })

  it('PATCH lets an ACCOUNT step keep its wall', async () => {
    h.stepFindFirst.mockResolvedValue({ id: 's1', audience: 'CUSTOM', channels: ['PUSH'], kind: 'ACCOUNT' })
    await PATCH(req({ blocking: true }), { params: params({ stepId: 's1' }) })
    expect(h.stepUpdate.mock.calls[0][0].data.blocking).toBe(true)
  })

  it('a PATCH that never mentions blocking does not write it', async () => {
    h.stepFindFirst.mockResolvedValue({ id: 's1', audience: 'CUSTOM', channels: ['PUSH'], kind: 'ACCOUNT' })
    await PATCH(req({ enabled: false }), { params: params({ stepId: 's1' }) })
    expect('blocking' in h.stepUpdate.mock.calls[0][0].data).toBe(false)
  })
})

// Zod's `.partial()` makes a key optional; it does NOT drop its `.default()`.
// So a patch meaning "turn this off" parses as { enabled:false, kind:'MESSAGE',
// actor:'CLIENT', blocking:false } — three facts nobody stated. Written
// straight through, flicking a FORM step's switch would turn it into a message
// step with an orphaned payload and nothing to read it.
describe('a patch writes only what was sent', () => {
  beforeEach(() => {
    h.stepFindFirst.mockResolvedValue({ id: 's1', audience: 'CUSTOM', channels: ['PUSH'], kind: 'FORM' })
  })

  it('does not stamp kind, actor or blocking onto an enabled-only toggle', async () => {
    await PATCH(req({ enabled: false }), { params: params({ stepId: 's1' }) })
    const data = h.stepUpdate.mock.calls[0][0].data
    expect(data).toEqual({ enabled: false })
  })

  it('still writes the fields that WERE sent', async () => {
    await PATCH(req({ kind: 'FORM', title: 'Fill this in', payload: { formId: 'f1' } }), {
      params: params({ stepId: 's1' }),
    })
    const data = h.stepUpdate.mock.calls[0][0].data
    expect(data.kind).toBe('FORM')
    expect(data.title).toBe('Fill this in')
    expect(data.payload).toEqual({ formId: 'f1' })
  })
})
