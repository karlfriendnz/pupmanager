import { describe, it, expect } from 'vitest'
import { telHref } from '@/lib/tel'

// Trainers type their number for reading, not for dialling. The admin call list
// turns it into a tel: link, and a dialler chokes on the decoration.

describe('telHref', () => {
  it('strips the spacing a human typed', () => {
    expect(telHref('021 555 0100')).toBe('tel:0215550100')
  })

  it('strips brackets and dashes', () => {
    expect(telHref('(09) 555-0100')).toBe('tel:095550100')
  })

  // The + is what makes an overseas number dial from another country, so it has
  // to survive — trainers are in six currencies and as many dialling codes.
  it('keeps a leading +', () => {
    expect(telHref('+64 21 555 0100')).toBe('tel:+64215550100')
    expect(telHref('  +44 7700 900000 ')).toBe('tel:+447700900000')
  })

  // A + anywhere else is a typo, and leaving it in would make the href invalid.
  it('drops a + that is not leading', () => {
    expect(telHref('021+555+0100')).toBe('tel:0215550100')
  })

  it('is null when there is nothing to dial', () => {
    for (const nothing of [null, undefined, '', '   ', '---', '()']) {
      expect(telHref(nothing)).toBeNull()
    }
  })
})
