import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Unit tests never touch a real DB.
const db = vi.hoisted(() => ({
  classEnrollment: { findMany: vi.fn() },
  package: { count: vi.fn() },
  classRun: { count: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const memberships = vi.hoisted(() => ({ loadPublishedMemberships: vi.fn() }))
vi.mock('@/lib/client-memberships', () => memberships)

import {
  hasBookableOfferings,
  selfBookablePackagesWhere,
  openClassRunsWhere,
  fullyEnrolledRunIds,
} from '@/lib/bookable-offerings'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '@/lib/feature-flags'

const NOW = new Date('2026-08-06T00:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  db.classEnrollment.findMany.mockResolvedValue([])
  db.package.count.mockResolvedValue(0)
  db.classRun.count.mockResolvedValue(0)
  memberships.loadPublishedMemberships.mockResolvedValue([])
})

describe('what counts as bookable', () => {
  it('asks only for self-bookable, visible, one-to-one offerings', () => {
    const where = selfBookablePackagesWhere('trainer-1', NOW)
    expect(where.trainerId).toBe('trainer-1')
    expect(where.clientSelfBook).toBe(true)
    // Load-bearing: a group offering is booked by its run, never off the
    // trainer's open hours.
    expect(where.isGroup).toBe(false)
    // Not one the trainer has scheduled to appear later.
    expect(where.OR).toEqual([{ visibleFrom: null }, { visibleFrom: { lte: NOW } }])
  })

  it('asks only for open runs with a live session still to come', () => {
    const where = openClassRunsWhere('trainer-1', [], NOW)
    expect(where.status).toEqual({ in: ['SCHEDULED', 'RUNNING'] })
    expect(where.sessions).toEqual({ some: { scheduledAt: { gte: NOW }, cancelledAt: null } })
    expect(where.package).toEqual({ OR: [{ visibleFrom: null }, { visibleFrom: { lte: NOW } }] })
  })

  it('drops the runs they already hold a full place in', () => {
    expect(openClassRunsWhere('trainer-1', ['run-a', 'run-b'], NOW).id)
      .toEqual({ notIn: ['run-a', 'run-b'] })
  })

  // Prisma's notIn on an empty array matches nothing at all, which would hide
  // every class from a client who has never enrolled in one.
  it('never hands prisma an empty notIn', () => {
    expect(openClassRunsWhere('trainer-1', [], NOW).id).toEqual({ notIn: ['__none__'] })
  })

  // A drop-in covers ONE session. Taking the whole run off the list after it
  // would hide the class from exactly the people most likely to come back.
  it('counts only FULL enrolments as "nothing left to book"', async () => {
    db.classEnrollment.findMany.mockResolvedValue([
      { classRunId: 'run-full', type: 'FULL' },
      { classRunId: 'run-dropin', type: 'DROP_IN' },
    ])
    expect(await fullyEnrolledRunIds('client-1')).toEqual(['run-full'])
  })
})

describe('hasBookableOfferings', () => {
  const args = { trainerId: 'trainer-1', clientId: 'client-1' }

  it('is false when there is nothing at all — the tile must not show', async () => {
    expect(await hasBookableOfferings(args, NOW)).toBe(false)
  })

  it('is true on a self-bookable one-to-one', async () => {
    db.package.count.mockResolvedValue(1)
    expect(await hasBookableOfferings(args, NOW)).toBe(true)
  })

  it('is true on an open class or event run', async () => {
    db.classRun.count.mockResolvedValue(2)
    expect(await hasBookableOfferings(args, NOW)).toBe(true)
  })

  it('excludes the runs they are already fully enrolled in from the count', async () => {
    db.classEnrollment.findMany.mockResolvedValue([{ classRunId: 'run-full', type: 'FULL' }])
    await hasBookableOfferings(args, NOW)
    expect(db.classRun.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: { notIn: ['run-full'] } }),
    })
  })

  it('does not go looking for memberships once something is bookable', async () => {
    db.package.count.mockResolvedValue(1)
    await hasBookableOfferings(args, NOW)
    expect(memberships.loadPublishedMemberships).not.toHaveBeenCalled()
  })

  // Packages are currently hidden from clients (feature-flags.ts). When that
  // flips back, a published membership is a bookable thing on its own — the
  // booking wizard counts it in the same breath as the other three.
  it('follows the packages-hidden flag for memberships', async () => {
    memberships.loadPublishedMemberships.mockResolvedValue([{ id: 'm1' }])
    expect(await hasBookableOfferings(args, NOW)).toBe(!PACKAGES_HIDDEN_FROM_CLIENTS)
  })
})

// ── Keeping the tile honest ──────────────────────────────────────────────────
//
// The tile hides itself by counting what /my-availability lists. The way that
// breaks is silently: someone widens the page's query and the tile keeps
// answering the old question, so a client is told there is nothing to book on a
// screen that has something on it.

const read = (rel: string) => readFileSync(resolve(__dirname, '../../src/' + rel), 'utf8')

describe('the home tile and the booking page count the same things', () => {
  it('the page builds its queries from the shared clauses', () => {
    const src = read('app/(client)/my-availability/page.tsx')
    expect(src).toContain('selfBookablePackagesWhere(profile.trainerId)')
    expect(src).toContain('openClassRunsWhere(profile.trainerId, enrolledRunIds, now)')
  })

  it('the wizard still calls it empty on the same four lists', () => {
    const src = read('app/(client)/my-availability/booking-wizard.tsx')
    expect(src).toContain(
      'const nothingToBook = packages.length === 0 && classes.length === 0 && events.length === 0 && memberships.length === 0',
    )
  })

  it('the home resolves it on the server, not in the browser', () => {
    const page = read('app/(client)/home/page.tsx')
    expect(page).toContain('hasBookableOfferings')
    expect(page).toContain('bookingEnabled={bookingEnabled}')
    // A 'use client' component must be handed the answer, never the means to
    // guess at it.
    expect(read('app/(client)/home/home-view.tsx')).not.toContain('hasBookableOfferings')
  })

  it('the tile row sizes itself from the tiles that are actually there', () => {
    const view = read('app/(client)/home/home-view.tsx')
    expect(view).toContain('QUICK_ACTION_COLS[quickActions.length]')
    // The old hard-coded pair, which can't express "one tile".
    expect(view).not.toContain("shopEnabled ? 'grid-cols-3' : 'grid-cols-2'")
  })
})

describe('the empty hero asks for the photo', () => {
  const view = () => read('app/(client)/home/home-view.tsx')

  it('offers the upload on the hero itself', () => {
    expect(view()).toContain('<DogPhotoHeroPrompt')
    expect(view()).toContain('heroEmpty && primaryDog')
  })

  // Nothing says the same thing twice: the card underneath asked for the very
  // photo the hero now asks for.
  it('has no second photo prompt underneath it', () => {
    expect(view()).not.toContain('<DogPhotoPrompt')
  })

  it('goes through the one uploader, and compresses first', () => {
    const src = read('app/(client)/home/dog-photo-prompt.tsx')
    // >4.5MB fails at the serverless body cap, which is what killed real
    // uploads straight off a phone.
    expect(src).toContain('compressImageFile(file)')
    expect(src).toContain('/api/dogs/${dogId}/photo')
    // One upload path, used by everything in the file.
    expect(src.match(/fetch\(/g)?.length).toBe(1)
  })

  it('adds no filled surface over the hero', () => {
    const src = read('app/(client)/home/dog-photo-prompt.tsx')
    expect(src).not.toContain("background: 'var(--accent)'")
    expect(src).not.toMatch(/className="[^"]*\bbg-(white|accent|slate)/)
  })
})
