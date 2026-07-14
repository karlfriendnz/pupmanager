import { describe, it, expect } from 'vitest'
import { fieldUsage, usedOnLabel } from '@/lib/field-usage'

describe('fieldUsage', () => {
  it('puts custom fields on intake and the new-client form', () => {
    expect(fieldUsage({ kind: 'CUSTOM', required: false, quickAdd: false })).toEqual({
      intake: true, newClient: true, quickAdd: false,
    })
  })

  it('keeps built-in detail fields (address, dog details) off intake', () => {
    expect(fieldUsage({ kind: 'DETAIL', required: true, quickAdd: false })).toEqual({
      intake: false, newClient: true, quickAdd: false,
    })
  })

  it('puts the core contact fields on intake', () => {
    expect(fieldUsage({ kind: 'CORE', required: true, quickAdd: true })).toEqual({
      intake: true, newClient: true, quickAdd: true,
    })
  })

  it('quick-add follows the field flag, whatever the kind', () => {
    expect(fieldUsage({ kind: 'CUSTOM', required: false, quickAdd: true }).quickAdd).toBe(true)
    expect(fieldUsage({ kind: 'DETAIL', required: false, quickAdd: true }).quickAdd).toBe(true)
  })

  it('required does not change WHERE a field appears, only whether it must be filled', () => {
    const off = fieldUsage({ kind: 'CUSTOM', required: false, quickAdd: false })
    const on = fieldUsage({ kind: 'CUSTOM', required: true, quickAdd: false })
    expect(on).toEqual(off)
  })
})

describe('usedOnLabel', () => {
  it('reads as the list of forms the field shows on', () => {
    expect(usedOnLabel({ kind: 'CUSTOM', required: true, quickAdd: true }))
      .toBe('Intake · New client · Quick add')
    expect(usedOnLabel({ kind: 'CUSTOM', required: false, quickAdd: false }))
      .toBe('Intake · New client')
    expect(usedOnLabel({ kind: 'DETAIL', required: false, quickAdd: true }))
      .toBe('New client · Quick add')
  })
})
