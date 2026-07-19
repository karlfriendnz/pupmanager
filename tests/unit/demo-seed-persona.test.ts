import { describe, it, expect } from 'vitest'
import { sampleContentForRoles } from '@/lib/demo-seed'

describe('sampleContentForRoles', () => {
  it("gives a groomer grooming data, not training data", () => {
    const c = sampleContentForRoles(['groomer'])
    expect(c.sessionTitles).toContain('Full groom')
    expect(c.sessionTitles).not.toContain('Crate training')
    expect(c.products.some(p => /shampoo|brush|de-shed/i.test(p.name))).toBe(true)
    expect(c.enquiryMessages.some(m => /groom|matted|nail/i.test(m))).toBe(true)
  })

  it('omits the exercise library and homework badges for non-training trades', () => {
    for (const role of ['groomer', 'walker', 'petsitter']) {
      const c = sampleContentForRoles([role])
      expect(c.library).toHaveLength(0)
      expect(c.achievements.some(a => a.triggerType === 'PERFECT_WEEK')).toBe(false)
      expect(c.achievements.some(a => a.triggerType === 'HOMEWORK_STREAK_DAYS')).toBe(false)
      // still gets the universal session-milestone badges
      expect(c.achievements.some(a => a.triggerType === 'FIRST_SESSION')).toBe(true)
    }
  })

  it('keeps the library + homework badges for training trades', () => {
    const c = sampleContentForRoles(['trainer'])
    expect(c.library.length).toBeGreaterThan(0)
    expect(c.achievements.some(a => a.triggerType === 'PERFECT_WEEK')).toBe(true)
  })

  it('falls back to the trainer set when roles are unknown', () => {
    const c = sampleContentForRoles([])
    expect(c.sessionTitles).toContain('Crate training')
    expect(c.library.length).toBeGreaterThan(0)
  })

  it('unions multiple trades without duplicates', () => {
    const c = sampleContentForRoles(['groomer', 'walker'])
    expect(c.sessionTitles).toContain('Full groom')
    expect(c.sessionTitles).toContain('Group walk')
    expect(new Set(c.sessionTitles).size).toBe(c.sessionTitles.length)
  })
})
