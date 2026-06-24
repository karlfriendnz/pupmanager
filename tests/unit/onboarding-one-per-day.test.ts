import { describe, it, expect, vi } from 'vitest'

// The module imports prisma at the top; mock it so importing is side-effect free.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { alreadySentOnboardingToday } from '@/lib/onboarding/send-emails'

const NZ = 'Pacific/Auckland'

describe('onboarding one-per-day guard', () => {
  const now = new Date('2026-06-25T20:00:00+12:00') // 8pm on the 25th, NZ

  it('false when nothing has been sent', () => {
    expect(alreadySentOnboardingToday([], NZ, now)).toBe(false)
  })

  it('true when an email already went out earlier the same local day', () => {
    const earlierToday = new Date('2026-06-25T07:30:00+12:00')
    expect(alreadySentOnboardingToday([earlierToday], NZ, now)).toBe(true)
  })

  it('false when the only prior send was a previous day', () => {
    const yesterday = new Date('2026-06-24T09:00:00+12:00')
    expect(alreadySentOnboardingToday([yesterday], NZ, now)).toBe(false)
  })

  it('respects the trainer timezone at the date boundary', () => {
    const sent = new Date('2026-06-25T13:00:00Z') // 25th in UTC, 26th in NZ
    const at = new Date('2026-06-26T08:00:00Z') // 26th in both UTC and NZ
    expect(alreadySentOnboardingToday([sent], NZ, at)).toBe(true) // same NZ day
    expect(alreadySentOnboardingToday([sent], 'UTC', at)).toBe(false) // different UTC day
  })
})
