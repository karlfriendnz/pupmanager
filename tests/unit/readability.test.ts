import { describe, it, expect } from 'vitest'
import { readability, readingEase } from '@/lib/readability'

describe('readability', () => {
  it('is empty for blank text', () => {
    expect(readability('   ')).toEqual({ grade: 0, words: 0, sentences: 0 })
  })

  it('counts words and sentences', () => {
    const r = readability('You can now type any address. It saves right away.')
    expect(r.words).toBe(10)
    expect(r.sentences).toBe(2)
  })

  it('rates simple copy as easy and dense copy as hard', () => {
    const simple = readability('You can now type any address. It saves right away.')
    const dense = readability(
      'Notwithstanding the aforementioned localisation infrastructure, administrators may subsequently reconfigure the corresponding notification preferences.',
    )
    expect(readingEase(simple.grade).tone).toBe('good')
    expect(dense.grade).toBeGreaterThan(simple.grade)
    expect(readingEase(dense.grade).tone).toBe('hard')
  })
})

describe('readingEase thresholds', () => {
  it('good ≤ 8, ok ≤ 11, hard above', () => {
    expect(readingEase(6).tone).toBe('good')
    expect(readingEase(8).tone).toBe('good')
    expect(readingEase(10).tone).toBe('ok')
    expect(readingEase(12).tone).toBe('hard')
  })
})
