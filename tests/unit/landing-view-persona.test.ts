import { describe, it, expect } from 'vitest'
import { landingViewForRoles } from '@/lib/onboarding-recommendations'

describe('landingViewForRoles', () => {
  it('sends appointment-book trades to the schedule', () => {
    expect(landingViewForRoles(['groomer'])).toBe('schedule')
    expect(landingViewForRoles(['walker'])).toBe('schedule')
    expect(landingViewForRoles(['petsitter'])).toBe('schedule')
  })

  it('sends programme/progress trades to the dashboard', () => {
    expect(landingViewForRoles(['trainer'])).toBe('dashboard')
    expect(landingViewForRoles(['behaviourist'])).toBe('dashboard')
  })

  it('leans to the dashboard when a trade is mixed with training', () => {
    expect(landingViewForRoles(['groomer', 'trainer'])).toBe('dashboard')
  })

  it('defaults to the dashboard when no role is known', () => {
    expect(landingViewForRoles([])).toBe('dashboard')
    expect(landingViewForRoles(['something-else'])).toBe('dashboard')
  })
})
