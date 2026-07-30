import { describe, it, expect } from 'vitest'
import {
  resolveSessionForm, hasOwnSessionForm, sessionFormSourceLabel,
} from '@/lib/session-form'

// A class is one group but not one kind of client: a puppy on foundations and a dog
// in for reactivity need different questions answered, in the same room, on the same
// night. Three levels can name a form and the most specific wins.

describe('resolveSessionForm', () => {
  it('uses the class default when nothing else has an opinion', () => {
    expect(resolveSessionForm({ classDefaultFormId: 'classForm' }))
      .toEqual({ formId: 'classForm', from: 'class' })
  })

  it('lets the session override the class', () => {
    expect(resolveSessionForm({ sessionFormId: 'assessment', classDefaultFormId: 'classForm' }))
      .toEqual({ formId: 'assessment', from: 'session' })
  })

  // Karl's case: client A on form X (the default), client B on form B.
  it('lets the client override both', () => {
    expect(resolveSessionForm({
      enrollmentFormId: 'reactivity',
      sessionFormId: 'assessment',
      classDefaultFormId: 'classForm',
    })).toEqual({ formId: 'reactivity', from: 'enrollment' })
  })

  it('falls all the way through to a recap-only write-up', () => {
    expect(resolveSessionForm({})).toEqual({ formId: null, from: 'none' })
  })

  // The distinction that makes the whole thing work: null means "no opinion, ask
  // the next one out", not "no form". Reading it as "no form" would make one
  // client's blank enrolment silently cancel the class's form for them.
  it('treats a blank level as no opinion, not as no form', () => {
    expect(resolveSessionForm({ enrollmentFormId: null, classDefaultFormId: 'classForm' }))
      .toEqual({ formId: 'classForm', from: 'class' })
    expect(resolveSessionForm({ enrollmentFormId: '   ', sessionFormId: 'assessment' }))
      .toEqual({ formId: 'assessment', from: 'session' })
    expect(resolveSessionForm({ enrollmentFormId: undefined, sessionFormId: undefined, classDefaultFormId: 'c' }))
      .toEqual({ formId: 'c', from: 'class' })
  })
})

describe('hasOwnSessionForm', () => {
  // Marks the roster row, so a per-client override isn't invisible until someone
  // opens the write-up and wonders why it looks different.
  it('is true only when the CLIENT is the reason', () => {
    expect(hasOwnSessionForm({ enrollmentFormId: 'x', classDefaultFormId: 'y' })).toBe(true)
    expect(hasOwnSessionForm({ sessionFormId: 'x', classDefaultFormId: 'y' })).toBe(false)
    expect(hasOwnSessionForm({ classDefaultFormId: 'y' })).toBe(false)
    expect(hasOwnSessionForm({})).toBe(false)
  })
})

describe('sessionFormSourceLabel', () => {
  it('names the exceptions', () => {
    expect(sessionFormSourceLabel('enrollment')).toBe('Just for them')
    expect(sessionFormSourceLabel('session')).toBe('This session')
  })

  // The normal case needs no chip — labelling every row says nothing.
  it('says nothing about the normal case', () => {
    expect(sessionFormSourceLabel('class')).toBeNull()
    expect(sessionFormSourceLabel('none')).toBeNull()
  })
})
