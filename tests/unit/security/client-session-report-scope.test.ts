import { describe, it, expect, vi, beforeEach } from 'vitest'

// The client-facing session screen, /my-sessions/[sessionId].
//
// Completing a session now publishes its write-up (lib/report-visibility), which
// moves a visibility decision that used to be a single `sentAt: { not: null }`
// filter into code. Two things have to stay true through that change:
//
//   1. A client can only ever read their OWN session's notes. The lookup is the
//      authorisation — there is no separate permission check on this page — so
//      it must be scoped to the signed-in client and nothing else.
//   2. An incomplete session's notes stay hidden. That is what makes a draft a
//      draft, and it is the trainer's only way to hold a half-written note back.

const h = vi.hoisted(() => ({
  getActiveClient: vi.fn(),
  clientFindUnique: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionFindMany: vi.fn(),
  customFieldFindMany: vi.fn(),
  formFindFirst: vi.fn(),
  redirect: vi.fn(() => { throw new Error('REDIRECT') }),
  notFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ redirect: h.redirect, notFound: h.notFound }))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.clientFindUnique },
    trainingSession: { findFirst: h.sessionFindFirst, findMany: h.sessionFindMany },
    customField: { findMany: h.customFieldFindMany },
    sessionForm: { findFirst: h.formFindFirst },
  },
}))

import ClientSessionPage from '@/app/(client)/my-sessions/[sessionId]/page'
import { SessionReport } from '@/components/shared/session-report'

const MINE = 'client-1'
const SESSION = 'sess-1'

/** Walk the returned tree for the SessionReport element and hand back its props. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findReportProps(node: any): any | null {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findReportProps(child)
      if (hit) return hit
    }
    return null
  }
  if (node.type === SessionReport) return node.props
  return findReportProps(node.props?.children ?? null)
}

function oneToOneSession(over: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    title: 'Recall',
    scheduledAt: new Date('2026-07-01T02:00:00Z'),
    status: 'UPCOMING',
    clientPackageId: null,
    clientPackage: null,
    dog: { name: 'Rusty' },
    tasks: [],
    attachments: [],
    formResponses: [
      {
        id: 'resp-1',
        sentAt: null,
        introMessage: null,
        closingMessage: null,
        answers: { q1: 'Rusty nailed the recall' },
        form: {
          id: 'form-1', name: 'Session notes', introText: null, closingText: null,
          backgroundColor: null, backgroundUrl: null,
          questions: [{ id: 'q1', type: 'LONG_TEXT', label: 'What we worked on' }],
        },
      },
    ],
    ...over,
  }
}

async function render() {
  return ClientSessionPage({ params: Promise.resolve({ sessionId: SESSION }) })
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.redirect.mockImplementation(() => { throw new Error('REDIRECT') })
  h.notFound.mockImplementation(() => { throw new Error('NOT_FOUND') })
  h.getActiveClient.mockResolvedValue({ clientId: MINE })
  h.clientFindUnique.mockResolvedValue({
    id: MINE, trainerId: 'trainer-1', trainer: { user: { timezone: 'Pacific/Auckland' } },
  })
  h.customFieldFindMany.mockResolvedValue([])
})

describe('a client can only read their OWN session', () => {
  it('scopes the 1:1 lookup to the signed-in client — the lookup IS the authorisation', async () => {
    h.sessionFindFirst.mockResolvedValueOnce(oneToOneSession({ status: 'COMPLETED' }))
    await render()
    const where = h.sessionFindFirst.mock.calls[0][0].where
    expect(where.id).toBe(SESSION)
    expect(where.clientId).toBe(MINE)
  })

  it("someone else's 1:1 session is a 404, not a report — both lookups miss", async () => {
    // Neither the 1:1 lookup (clientId scoped) nor the class lookup (enrolment
    // scoped) matches, because the session belongs to a different household.
    h.sessionFindFirst.mockResolvedValue(null)
    await expect(render()).rejects.toThrow('NOT_FOUND')
    expect(h.notFound).toHaveBeenCalled()
  })

  it('the class fallback is scoped to an enrolment of THIS client', async () => {
    h.sessionFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        title: 'Puppy Foundations', scheduledAt: new Date('2026-07-01T02:00:00Z'),
        sessionFormId: null, sessionIndex: 0, status: 'COMPLETED',
        classRun: { name: 'Puppy Foundations', package: null },
        attendance: [],
      })
    await render()
    const where = h.sessionFindFirst.mock.calls[1][0].where
    expect(where.classRun.enrollments.some.clientId).toBe(MINE)
  })
})

describe('an incomplete session keeps its notes to itself', () => {
  it('hides a saved write-up while the session is still UPCOMING', async () => {
    h.sessionFindFirst.mockResolvedValueOnce(oneToOneSession({ status: 'UPCOMING' }))
    const props = findReportProps(await render())
    expect(props).not.toBeNull()
    expect(props.formResponses).toEqual([])
  })

  it('marking it complete reveals it — no send step, which is the point', async () => {
    h.sessionFindFirst.mockResolvedValueOnce(oneToOneSession({ status: 'COMPLETED' }))
    const props = findReportProps(await render())
    expect(props.formResponses).toHaveLength(1)
    expect(props.formResponses[0].answers).toEqual({ q1: 'Rusty nailed the recall' })
  })

  it('a note released early is readable even on an UPCOMING session', async () => {
    const s = oneToOneSession({ status: 'UPCOMING' })
    s.formResponses[0].sentAt = new Date('2026-07-02T00:00:00Z') as never
    h.sessionFindFirst.mockResolvedValueOnce(s)
    const props = findReportProps(await render())
    expect(props.formResponses).toHaveLength(1)
  })

  it("a class attendee's report waits for the register too", async () => {
    h.sessionFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        title: 'Puppy Foundations', scheduledAt: new Date('2026-07-01T02:00:00Z'),
        sessionFormId: 'form-1', sessionIndex: 0, status: 'UPCOMING',
        classRun: { name: 'Puppy Foundations', package: null },
        attendance: [{ report: { answers: { q1: 'Settled well' } }, reportSentAt: null }],
      })
    h.formFindFirst.mockResolvedValue({
      id: 'form-1', name: 'Class notes', introText: null, closingText: null,
      backgroundColor: null, backgroundUrl: null, questions: [],
    })
    const tree = await render()
    // No report → the page falls back to the "not written up yet" card, so there
    // is no SessionReport in the tree at all.
    expect(findReportProps(tree)).toBeNull()
  })
})
