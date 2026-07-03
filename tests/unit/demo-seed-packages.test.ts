import { describe, it, expect } from 'vitest'
import { packageDefsFor } from '@/lib/demo-seed'

// The "Explore with sample data" flow tailors the demo packages to the trainer's
// onboarding roles. These guard that a dog walker doesn't land in a training demo.
describe('packageDefsFor — persona-tailored sample packages', () => {
  it('a dog walker gets walk packages, not training classes', () => {
    const names = packageDefsFor(['walker']).map(p => p.name)
    expect(names).toContain('Solo Walk')
    expect(names).toContain('Group Walk')
    expect(names).not.toContain('Puppy Foundations')
  })

  it('a groomer gets grooming packages', () => {
    const names = packageDefsFor(['groomer']).map(p => p.name)
    expect(names).toContain('Full Groom')
    expect(names).not.toContain('Reactive Rover')
  })

  it('a pet sitter gets sitting packages', () => {
    expect(packageDefsFor(['petsitter']).map(p => p.name)).toContain('Overnight Stay')
  })

  it('only trainer/behaviourist sets contain group (class) packages', () => {
    // Walkers/groomers/sitters must have NO isGroup packages, so no classes seed.
    expect(packageDefsFor(['walker']).some(p => p.isGroup)).toBe(false)
    expect(packageDefsFor(['groomer']).some(p => p.isGroup)).toBe(false)
    expect(packageDefsFor(['petsitter']).some(p => p.isGroup)).toBe(false)
    // Trainers do (that's what surfaces the Classes feature in the demo).
    expect(packageDefsFor(['trainer']).some(p => p.isGroup)).toBe(true)
  })

  it('unions multiple roles (deduped) and falls back to training when none given', () => {
    const combined = packageDefsFor(['walker', 'groomer']).map(p => p.name)
    expect(combined).toEqual(expect.arrayContaining(['Solo Walk', 'Full Groom']))
    expect(new Set(combined).size).toBe(combined.length)
    // No roles → training set fallback.
    expect(packageDefsFor([]).map(p => p.name)).toContain('Puppy Foundations')
  })
})
