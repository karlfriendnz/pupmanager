import { describe, it, expect, vi, beforeEach } from 'vitest'

// `continueIntakeFormId` arrives from a form editor in a browser. Rendering a
// form id from another business would show a stranger that business's questions
// — and their custom fields — the moment they finished an enquiry here. So the
// id is resolved as "one of THIS trainer's intake forms", or it becomes null.

const h = vi.hoisted(() => ({ formFindFirst: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: { form: { findFirst: h.formFindFirst } } }))

import { resolveContinuationIntakeForm } from '@/lib/form-api'

beforeEach(() => {
  h.formFindFirst.mockReset()
})

describe('resolveContinuationIntakeForm — tenant scoping', () => {
  it('scopes the lookup to the trainer AND to intake use', async () => {
    h.formFindFirst.mockResolvedValue({ id: 'intake1' })

    const out = await resolveContinuationIntakeForm('intake1', 'trainerA')

    expect(out).toBe('intake1')
    expect(h.formFindFirst).toHaveBeenCalledWith({
      where: { id: 'intake1', trainerId: 'trainerA', usableAsIntake: true },
      select: { id: true },
    })
  })

  it('nulls another trainer’s form id rather than storing it', async () => {
    // The scoped query simply finds nothing.
    h.formFindFirst.mockResolvedValue(null)
    expect(await resolveContinuationIntakeForm('trainerBs-form', 'trainerA')).toBeNull()
  })

  it('nulls a form that is not usable as an intake form', async () => {
    h.formFindFirst.mockResolvedValue(null)
    expect(await resolveContinuationIntakeForm('enquiry-only', 'trainerA')).toBeNull()
  })

  it('refuses to let a form hand over to itself', async () => {
    // Otherwise somebody who just answered these questions is put straight back
    // into them.
    expect(await resolveContinuationIntakeForm('form1', 'trainerA', 'form1')).toBeNull()
    expect(h.formFindFirst).not.toHaveBeenCalled()
  })

  it('treats an empty string as "nothing", not as a lookup', async () => {
    expect(await resolveContinuationIntakeForm('', 'trainerA')).toBeNull()
    expect(await resolveContinuationIntakeForm(null, 'trainerA')).toBeNull()
    expect(h.formFindFirst).not.toHaveBeenCalled()
  })

  it('leaves the column alone when the PATCH did not mention it', async () => {
    // A publish toggle sends `{ isActive }` on its own and must not clear the
    // handover as a side effect.
    expect(await resolveContinuationIntakeForm(undefined, 'trainerA')).toBeUndefined()
    expect(h.formFindFirst).not.toHaveBeenCalled()
  })
})
