import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/lib/prisma', () => ({ prisma: {} }))

import { isSelfBookable, sessionTitle, generateSessionDates } from '../../src/lib/self-book'

describe('isSelfBookable', () => {
  it('only when the trainer opted the package in', () => {
    expect(isSelfBookable({ clientSelfBook: true })).toBe(true)
    expect(isSelfBookable({ clientSelfBook: false })).toBe(false)
  })
})

describe('sessionTitle', () => {
  it('single-session package has no numbering', () => {
    expect(sessionTitle('Puppy Intro', 1, 0)).toBe('Puppy Intro')
  })
  it('multi-session is N/M', () => {
    expect(sessionTitle('Reactive Rover', 6, 2)).toBe('Reactive Rover — session 3/6')
  })
  it('ongoing (sessionCount 0) is just an index', () => {
    expect(sessionTitle('Drop-in', 0, 4)).toBe('Drop-in — session 5')
  })
})

describe('generateSessionDates (reused from class-runs)', () => {
  it('places sessions on the package cadence from the chosen start', () => {
    const start = new Date('2026-06-02T18:00:00.000Z')
    const d = generateSessionDates(start, 4, 2) // 4 sessions, fortnightly
    expect(d).toHaveLength(4)
    expect(d[1].toISOString()).toBe('2026-06-16T18:00:00.000Z')
    expect(d[3].toISOString()).toBe('2026-07-14T18:00:00.000Z')
  })
})
