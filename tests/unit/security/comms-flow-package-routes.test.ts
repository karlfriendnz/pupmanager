import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// Tenant + permission guards for the 1:1-package comms-flow routes: a trainer
// can only touch flows on packages their own company owns, and a caller without
// packages.manage is refused before any write.

const h = vi.hoisted(() => ({
  guard: vi.fn(),
  pkgFindFirst: vi.fn(),
  stepFindFirst: vi.fn(),
  stepCreate: vi.fn(),
  stepCreateMany: vi.fn(),
  stepUpdate: vi.fn(),
  stepDelete: vi.fn(),
  tmplFindFirst: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guard }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    package: { findFirst: h.pkgFindFirst },
    commsFlowStep: { findFirst: h.stepFindFirst, findMany: vi.fn(() => []), create: h.stepCreate, createMany: h.stepCreateMany, update: h.stepUpdate, delete: h.stepDelete },
    commsFlowTemplate: { findFirst: h.tmplFindFirst },
  },
}))

import { POST as createStep } from '@/app/api/trainer/packages/[packageId]/comms-flow/route'
import { PATCH as patchStep, DELETE as deleteStep } from '@/app/api/trainer/packages/[packageId]/comms-flow/[stepId]/route'
import { POST as applyTemplate } from '@/app/api/trainer/packages/[packageId]/comms-flow/apply-template/route'

function req(body: unknown = {}) {
  return new Request('https://app.pupmanager.com/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
const pkgParams = { params: Promise.resolve({ packageId: 'p1' }) }
const stepParams = { params: Promise.resolve({ packageId: 'p1', stepId: 'step1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  h.guard.mockResolvedValue({ companyId: 't1' })
})

describe('package comms-flow route guards', () => {
  it('refuses a caller without packages.manage before any write', async () => {
    h.guard.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await createStep(req({}), pkgParams)
    expect(res.status).toBe(403)
    expect(h.stepCreate).not.toHaveBeenCalled()
  })

  it('404s creating a step on a package another company owns', async () => {
    h.pkgFindFirst.mockResolvedValue(null)
    const res = await createStep(req({}), pkgParams)
    expect(res.status).toBe(404)
    expect(h.stepCreate).not.toHaveBeenCalled()
  })

  it("404s patching a step not on the caller's package", async () => {
    h.stepFindFirst.mockResolvedValue(null)
    const res = await patchStep(req({ title: 'x' }), stepParams)
    expect(res.status).toBe(404)
    expect(h.stepUpdate).not.toHaveBeenCalled()
  })

  it("404s deleting a step not on the caller's package", async () => {
    h.stepFindFirst.mockResolvedValue(null)
    const res = await deleteStep(req(), stepParams)
    expect(res.status).toBe(404)
    expect(h.stepDelete).not.toHaveBeenCalled()
  })

  it('404s applying a template the caller does not own', async () => {
    h.pkgFindFirst.mockResolvedValue({ id: 'p1' })
    h.tmplFindFirst.mockResolvedValue(null)
    const res = await applyTemplate(req({ templateId: 'tmpl-x' }), pkgParams)
    expect(res.status).toBe(404)
    expect(h.stepCreateMany).not.toHaveBeenCalled()
  })
})
