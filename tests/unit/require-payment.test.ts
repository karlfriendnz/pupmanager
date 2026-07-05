import { describe, it, expect } from 'vitest'
import { resolveRequirePayment } from '../../src/lib/require-payment'

// Truth table for the per-item override × trainer-default fallback.
describe('resolveRequirePayment', () => {
  it('item=true always requires payment, regardless of the trainer default', () => {
    expect(resolveRequirePayment(true, true)).toBe(true)
    expect(resolveRequirePayment(true, false)).toBe(true)
  })

  it('item=false never requires payment, regardless of the trainer default', () => {
    expect(resolveRequirePayment(false, true)).toBe(false)
    expect(resolveRequirePayment(false, false)).toBe(false)
  })

  it('item=null inherits the trainer default', () => {
    expect(resolveRequirePayment(null, true)).toBe(true)
    expect(resolveRequirePayment(null, false)).toBe(false)
  })
})
