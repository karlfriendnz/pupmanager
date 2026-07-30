import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveSessionForm } from '@/lib/session-form'

const route = () => readFileSync(resolve(
  __dirname, '../../src/app/api/class-runs/[runId]/sessions/[sessionId]/attendance/route.ts'), 'utf8')

// Karl's case: "one client needs form x, the other needs form b, and the default
// is form x." Three levels can name a form; the API has to resolve per ROSTER ROW
// rather than once per session, and persist a client's choice on the ENROLMENT.

describe('the attendance API resolves a form per client', () => {
  it('resolves each roster row, not just the session', () => {
    expect(route()).toContain('enrollmentFormId: e.sessionFormId')
    expect(route()).toContain('formSource: r.from')
  })

  // Loading only the session's form would leave a client on a different form with
  // no questions to answer.
  it('loads every form the trainer has, so any row can render', () => {
    expect(route()).toContain('prisma.sessionForm.findMany({ where: { trainerId }')
  })

  // It's "Rex is in for reactivity" — true every week, not just tonight.
  it('stores a client’s choice on the enrolment', () => {
    expect(route()).toContain('prisma.classEnrollment.update')
    expect(route()).toContain('data: { sessionFormId: r.ownFormId ?? null }')
  })

  // The one that would silently destroy data: an attendance save sends a record
  // per person, so treating an omitted field as null would wipe every override on
  // the register.
  it('only touches rows that actually said something about the form', () => {
    expect(route()).toContain("r.ownFormId !== undefined")
  })
})

describe('the resolution the API relies on', () => {
  it('gives Karl’s example the right answers', () => {
    const classDefault = 'formX'
    // Client A: nothing of their own → the class default.
    expect(resolveSessionForm({ enrollmentFormId: null, classDefaultFormId: classDefault }))
      .toEqual({ formId: 'formX', from: 'class' })
    // Client B: their own form.
    expect(resolveSessionForm({ enrollmentFormId: 'formB', classDefaultFormId: classDefault }))
      .toEqual({ formId: 'formB', from: 'enrollment' })
  })
})
