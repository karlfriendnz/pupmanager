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

  it('yields at least one client-self-bookable package (so the booking demo works)', () => {
    // The demo trainer must ship packages a client can self-book, or the
    // client-side booking flow can't be exercised out of the box.
    const trainer = packageDefsFor(['trainer'])
    const selfBookable = trainer.filter(p => p.clientSelfBook)
    expect(selfBookable.length).toBeGreaterThanOrEqual(1)
  })

  it('varies the self-book packages across every booking path', () => {
    const byName = new Map(packageDefsFor(['trainer']).map(p => [p.name, p]))
    // Instant + free (no approval, no price).
    expect(byName.get('Virtual Coaching')).toMatchObject({ clientSelfBook: true, selfBookRequiresApproval: false, priceCents: null })
    // Instant + priced, require-payment (pay-to-book).
    expect(byName.get('Loose-Leash Bootcamp')).toMatchObject({ clientSelfBook: true, selfBookRequiresApproval: false, requirePayment: true })
    // Priced + require-approval (booking request).
    expect(byName.get('Confident Adolescent')).toMatchObject({ clientSelfBook: true, selfBookRequiresApproval: true })
    // Priced + require-payment OFF (book now, pay later).
    expect(byName.get('Anxious Dog Programme')).toMatchObject({ clientSelfBook: true, selfBookRequiresApproval: false, requirePayment: false })
  })

  it('yields at least one client-bookable class (a free group class enrols instantly)', () => {
    // A class is enrollable by a client without payment config only when it's a
    // group package with no price — assert one exists so /my-classes has a
    // seat a client can actually take.
    const trainer = packageDefsFor(['trainer'])
    const bookableClass = trainer.filter(p => p.isGroup && (p.priceCents === null || p.priceCents === 0))
    expect(bookableClass.length).toBeGreaterThanOrEqual(1)
  })

  it('unions multiple roles (deduped) and falls back to training when none given', () => {
    const combined = packageDefsFor(['walker', 'groomer']).map(p => p.name)
    expect(combined).toEqual(expect.arrayContaining(['Solo Walk', 'Full Groom']))
    expect(new Set(combined).size).toBe(combined.length)
    // No roles → training set fallback.
    expect(packageDefsFor([]).map(p => p.name)).toContain('Puppy Foundations')
  })
})
