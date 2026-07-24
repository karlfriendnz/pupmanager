import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Tenant + permission guards for the comms-flow routes: a trainer can only
// touch flows on runs/templates their own company owns, and a caller without
// classes.manage is refused before any write.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  runFindFirst: vi.fn(),
  stepFindFirst: vi.fn(),
  stepFindMany: vi.fn(),
  stepCreate: vi.fn(),
  stepCreateMany: vi.fn(),
  stepUpdate: vi.fn(),
  stepDelete: vi.fn(),
  tmplFindFirst: vi.fn(),
  tmplCreate: vi.fn(),
  tmplDelete: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    classRun: { findFirst: h.runFindFirst },
    commsFlowStep: {
      findFirst: h.stepFindFirst, findMany: h.stepFindMany, create: h.stepCreate,
      createMany: h.stepCreateMany, update: h.stepUpdate, delete: h.stepDelete,
    },
    commsFlowTemplate: { findFirst: h.tmplFindFirst, create: h.tmplCreate, delete: h.tmplDelete },
  },
}))

import { POST as createStep } from '@/app/api/trainer/class-runs/[runId]/comms-flow/route'
import { PATCH as patchStep, DELETE as deleteStep } from '@/app/api/trainer/class-runs/[runId]/comms-flow/[stepId]/route'
import { POST as applyTemplate } from '@/app/api/trainer/class-runs/[runId]/comms-flow/apply-template/route'
import { POST as saveTemplate } from '@/app/api/trainer/comms-flow-templates/route'
import { DELETE as deleteTemplate } from '@/app/api/trainer/comms-flow-templates/[templateId]/route'

function req(body: unknown = {}) {
  return new Request('https://app.pupmanager.com/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const runParams = { params: Promise.resolve({ runId: 'r1' }) }
const stepParams = { params: Promise.resolve({ runId: 'r1', stepId: 'step1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't1' })
})

describe('comms-flow route guards', () => {
  it('refuses a caller without classes.manage before any write', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await createStep(req({}), runParams)
    expect(res.status).toBe(403)
    expect(h.stepCreate).not.toHaveBeenCalled()
    expect(h.stepCreateMany).not.toHaveBeenCalled()
  })

  it('404s creating a step on a run another company owns', async () => {
    h.runFindFirst.mockResolvedValue(null) // not found for this company
    const res = await createStep(req({}), runParams)
    expect(res.status).toBe(404)
    expect(h.stepCreate).not.toHaveBeenCalled()
  })

  it('404s patching a step not on the caller\'s run', async () => {
    h.stepFindFirst.mockResolvedValue(null)
    const res = await patchStep(req({ title: 'x' }), stepParams)
    expect(res.status).toBe(404)
    expect(h.stepUpdate).not.toHaveBeenCalled()
  })

  it('404s deleting a step not on the caller\'s run', async () => {
    h.stepFindFirst.mockResolvedValue(null)
    const res = await deleteStep(req(), stepParams)
    expect(res.status).toBe(404)
    expect(h.stepDelete).not.toHaveBeenCalled()
  })

  it('404s applying a template the caller does not own', async () => {
    h.runFindFirst.mockResolvedValue({ id: 'r1' })
    h.tmplFindFirst.mockResolvedValue(null) // template belongs to someone else
    const res = await applyTemplate(req({ templateId: 'tmpl-x' }), runParams)
    expect(res.status).toBe(404)
    expect(h.stepCreateMany).not.toHaveBeenCalled()
  })

  it('404s saving a template from a run another company owns', async () => {
    h.runFindFirst.mockResolvedValue(null)
    const res = await saveTemplate(req({ name: 'My flow', runId: 'r1' }))
    expect(res.status).toBe(404)
    expect(h.tmplCreate).not.toHaveBeenCalled()
  })

  it('404s deleting a template the caller does not own', async () => {
    h.tmplFindFirst.mockResolvedValue(null)
    const res = await deleteTemplate(req(), { params: Promise.resolve({ templateId: 'tmpl-x' }) })
    expect(res.status).toBe(404)
    expect(h.tmplDelete).not.toHaveBeenCalled()
  })
})
