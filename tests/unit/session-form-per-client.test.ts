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

const view = () => readFileSync(resolve(
  __dirname, '../../src/app/(trainer)/classes/[runId]/sessions/[sessionId]/session-view.tsx'), 'utf8')

describe('the session screen writes each client up on their own form', () => {
  // The whole point of the feature: the questions on screen have to come from
  // THIS client's resolved form. Rendering the session's form for everyone is
  // exactly the behaviour the override was added to replace.
  it('renders the questions from the row’s form, not the session’s', () => {
    expect(view()).toContain('data?.availableForms.find(f => f.id === notesRow.formId)')
    expect(view()).toContain('notesForm?.questions.map')
  })

  // An override is otherwise invisible until you open someone's write-up and
  // wonder why it looks different from the rest of the register.
  it('marks the roster row when a client is on their own', () => {
    expect(view()).toContain("r.formSource === 'enrollment'")
    expect(view()).toContain('Own form')
  })

  // It belongs to the enrolment, so a trainer who sets it and closes the screen
  // expects it to have stuck — not to be waiting on a Save they never made.
  it('saves the choice on the spot', () => {
    expect(view()).toContain('async function setOwnForm')
    expect(view()).toContain("put({ records: [{ enrollmentId, ownFormId: id }] })")
  })

  // Regression: saveNotes used to send the RESOLVED form as sessionFormId, which
  // copied the class default down onto the session — so later changing the class
  // default silently stopped reaching a session someone had been written up on.
  it('writing up one client doesn’t reassign the whole session’s form', () => {
    const notes = view().slice(view().indexOf('async function saveNotes'))
    // The KEY, not the word — the comment above the call explains the omission.
    expect(notes.slice(0, notes.indexOf('async function setOwnForm')))
      .not.toContain('sessionFormId:')
  })

  // The override is the exception, so the picker leads with the way back to
  // everyone else's form rather than presenting a blank to fill in.
  it('offers the way back to the class default', () => {
    expect(view()).toContain('Same as the rest of the class')
    expect(view()).toContain("id === 'default' ? null : id")
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
