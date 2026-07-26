import { describe, it, expect } from 'vitest'
import {
  contrastRatio, mixToward, parseHex, resolveButtonColors, MIN_CONTRAST, DEFAULT_FEATURED,
} from '@/lib/membership-card-colors'

// The membership card's buy button lets a trainer pick both a background and a
// label colour, so it lets them pick an unreadable pair. These pin the guard
// that stops that reaching a client: nothing renders below 4.5:1.

describe('parseHex', () => {
  it('takes 3- and 6-digit hex, and nothing else', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('#0F172A')).toEqual([15, 23, 42])
    expect(parseHex(' #14b8a6 ')).toEqual([20, 184, 166])
    expect(parseHex('white')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
    expect(parseHex(null)).toBeNull()
    expect(parseHex('')).toBeNull()
  })
})

describe('contrastRatio', () => {
  it('matches the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })
  it('is symmetric and safe on junk input', () => {
    expect(contrastRatio('#7c3aed', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#7c3aed'), 6)
    expect(contrastRatio('nope', '#fff')).toBe(1)
  })
})

describe('mixToward', () => {
  it('behaves like color-mix(in srgb, colour w%, target)', () => {
    expect(mixToward('#ffffff', '#000000', 100)).toBe('#ffffff')
    expect(mixToward('#ffffff', '#000000', 0)).toBe('#000000')
    expect(mixToward('#ffffff', '#000000', 50)).toBe('#808080')
  })
  it('leaves an unparseable colour alone', () => {
    expect(mixToward('teal', '#0f172a', 50)).toBe('teal')
  })
})

describe('resolveButtonColors', () => {
  it('falls back to the card\'s featured colour, then the app default', () => {
    expect(resolveButtonColors(null, null, '#0d9488').background).toBe('#0d9488')
    expect(resolveButtonColors(null, null, null).background).toBe(DEFAULT_FEATURED)
    // A malformed stored value is ignored rather than painted.
    expect(resolveButtonColors('rgb(1,2,3)', null, '#0d9488').background).toBe('#0d9488')
  })

  it('picks a legible label when the trainer has not chosen one', () => {
    const dark = resolveButtonColors('#0f172a', null, null)
    expect(dark.color).toBe('#ffffff')
    expect(dark.adjusted).toBe(false)

    const pale = resolveButtonColors('#fef08a', null, null)
    expect(pale.color).toBe('#0f172a')
    expect(pale.adjusted).toBe(false)
  })

  it('keeps a trainer pair that already reads well', () => {
    const out = resolveButtonColors('#7c3aed', '#ffffff', null)
    expect(out).toMatchObject({ background: '#7c3aed', color: '#ffffff', adjusted: false })
    expect(out.ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('deepens white-on-pale rather than shipping it', () => {
    const out = resolveButtonColors('#fef08a', '#ffffff', null)
    expect(out.adjusted).toBe(true)
    expect(out.color).not.toBe('#ffffff')
    expect(contrastRatio(out.background, out.color)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('lightens dark-on-dark rather than shipping it', () => {
    const out = resolveButtonColors('#0f172a', '#1e293b', null)
    expect(out.adjusted).toBe(true)
    expect(contrastRatio(out.background, out.color)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it('never returns a pair below 4.5:1 across a spread of backgrounds', () => {
    const backgrounds = ['#ffffff', '#000000', '#7c3aed', '#0d9488', '#fef08a', '#e11d48', '#38bdf8', '#94a3b8', '#f8fafc']
    const labels = ['#ffffff', '#000000', '#94a3b8', '#7c3aed', '#fef08a', null]
    for (const bg of backgrounds) {
      for (const label of labels) {
        const out = resolveButtonColors(bg, label, null)
        expect(
          contrastRatio(out.background, out.color),
          `${bg} + ${label ?? 'auto'} rendered ${out.color}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST)
      }
    }
  })

  it('flags a mid-tone background it cannot fully rescue instead of throwing', () => {
    // #808080 clears 4.5:1 against neither white nor near-black; we take the best.
    const out = resolveButtonColors('#808080', '#7f7f7f', null)
    expect(out.adjusted).toBe(true)
    expect(['#ffffff', '#0f172a']).toContain(out.color)
  })
})
