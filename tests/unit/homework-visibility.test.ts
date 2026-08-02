import { describe, it, expect } from 'vitest'
import { clientVisibleHomeworkWhere, isHomeworkVisibleToClient } from '@/lib/homework-visibility'

// The gate that decides whether a CLIENT can see a piece of homework yet.
//
// Two ways to get this wrong, and both are silent: leak the practice for a
// session that hasn't happened (a spoiler, and the trainer's write-up before
// they have written it up), or hide the preparation the client was supposed to
// read first ("bring a hungry dog and a pot of chicken"). These pin both.

const NOW = new Date('2026-08-02T09:00:00.000Z')
const PAST = new Date('2026-08-01T09:00:00.000Z')
const FUTURE = new Date('2026-08-09T09:00:00.000Z')

describe('clientVisibleHomeworkWhere', () => {
  it('lets preparation through unconditionally', () => {
    const { OR } = clientVisibleHomeworkWhere(NOW)
    expect(OR?.[0]).toEqual({ timing: 'BEFORE_SESSION' })
  })

  it('lets homework with no session behind it through', () => {
    const { OR } = clientVisibleHomeworkWhere(NOW)
    expect(OR).toContainEqual({ sessionId: null })
  })

  it('gates the rest on the session having STARTED, not ended', () => {
    const { OR } = clientVisibleHomeworkWhere(NOW)
    // The start time, compared as an instant. Deliberately not
    // scheduledAt + durationMins — a class running ten minutes over must not
    // hold its homework back, and Prisma can't add the two in a where anyway.
    expect(OR).toContainEqual({ session: { scheduledAt: { lte: NOW } } })
  })

  it('also releases homework the trainer has marked done, whatever the clock says', () => {
    const { OR } = clientVisibleHomeworkWhere(NOW)
    expect(OR).toContainEqual({ session: { status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] } } })
  })

  it('offers no other conditions — nothing else may narrow it', () => {
    // A regression guard: if someone adds a fifth branch, they have to think
    // about it here first. Four OR branches, no top-level AND/NOT.
    const where = clientVisibleHomeworkWhere(NOW)
    expect(Object.keys(where)).toEqual(['OR'])
    expect(where.OR).toHaveLength(4)
  })
})

describe('isHomeworkVisibleToClient', () => {
  const after = (session: { scheduledAt: Date; status: string } | null) => ({
    timing: 'AFTER_SESSION' as const,
    sessionId: session ? 's1' : null,
    session,
  })

  it('shows preparation even for a session weeks away', () => {
    expect(
      isHomeworkVisibleToClient(
        { timing: 'BEFORE_SESSION', sessionId: 's1', session: { scheduledAt: FUTURE, status: 'UPCOMING' } },
        NOW,
      ),
    ).toBe(true)
  })

  it('hides practice until its session has started', () => {
    expect(isHomeworkVisibleToClient(after({ scheduledAt: FUTURE, status: 'UPCOMING' }), NOW)).toBe(false)
    expect(isHomeworkVisibleToClient(after({ scheduledAt: PAST, status: 'UPCOMING' }), NOW)).toBe(true)
  })

  it('treats the exact start instant as run', () => {
    expect(isHomeworkVisibleToClient(after({ scheduledAt: NOW, status: 'UPCOMING' }), NOW)).toBe(true)
  })

  it('releases practice on a session finished early', () => {
    // The register is the accurate signal and the unreliable one — plenty of
    // trainers never tick it — so it can only ever UNLOCK, never withhold.
    for (const status of ['COMPLETED', 'COMMENTED', 'INVOICED']) {
      expect(isHomeworkVisibleToClient(after({ scheduledAt: FUTURE, status }), NOW)).toBe(true)
    }
  })

  it('shows practice that hangs off no session at all', () => {
    expect(isHomeworkVisibleToClient(after(null), NOW)).toBe(true)
  })

  it('fails CLOSED when the session was never joined', () => {
    // A caller who forgot to include the session must not read "not loaded" as
    // "no session" and reveal the lot.
    expect(
      isHomeworkVisibleToClient({ timing: 'AFTER_SESSION', sessionId: 's1' }, NOW),
    ).toBe(false)
  })
})
