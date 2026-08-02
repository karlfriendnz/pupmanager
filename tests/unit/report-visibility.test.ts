import { describe, it, expect } from 'vitest'
import {
  SESSION_DONE_STATUSES,
  isSessionDone,
  clientVisibleReportWhere,
  isReportVisibleToClient,
  isAttendanceReportVisibleToClient,
  reportHasContent,
  attendanceReportHasContent,
} from '@/lib/report-visibility'

// The rule that replaced the Send button: marking a session complete is what
// shows its write-up to the client. See lib/report-visibility for the reasoning.

describe('isSessionDone', () => {
  it('counts the three statuses that mean the trainer called it done', () => {
    for (const s of SESSION_DONE_STATUSES) expect(isSessionDone(s)).toBe(true)
  })

  it('an UPCOMING session is not done', () => {
    expect(isSessionDone('UPCOMING')).toBe(false)
  })

  it('a missing status is not done — never fail open', () => {
    expect(isSessionDone(null)).toBe(false)
    expect(isSessionDone(undefined)).toBe(false)
    expect(isSessionDone('')).toBe(false)
  })
})

describe('isReportVisibleToClient', () => {
  it("an incomplete session's notes stay hidden — this is the whole point of a draft", () => {
    expect(isReportVisibleToClient({ sentAt: null }, 'UPCOMING')).toBe(false)
  })

  it('completing the session reveals the notes, with no send step', () => {
    expect(isReportVisibleToClient({ sentAt: null }, 'COMPLETED')).toBe(true)
    expect(isReportVisibleToClient({ sentAt: null }, 'COMMENTED')).toBe(true)
    expect(isReportVisibleToClient({ sentAt: null }, 'INVOICED')).toBe(true)
  })

  it('a note released early stays readable even though nobody marked the session done', () => {
    // Nothing a client could already read is taken back off them.
    expect(isReportVisibleToClient({ sentAt: new Date('2026-07-01') }, 'UPCOMING')).toBe(true)
  })

  it('the clock is deliberately not part of the rule — a past session is still not "done"', () => {
    // lib/homework-visibility ORs in scheduledAt because a missing tick must not
    // hide homework. A recap is the trainer's writing, so the opposite applies.
    expect(isReportVisibleToClient({ sentAt: null }, 'UPCOMING')).toBe(false)
  })
})

describe('isAttendanceReportVisibleToClient', () => {
  it('follows the same rule as a 1:1 write-up — same promise, same person', () => {
    expect(isAttendanceReportVisibleToClient({ reportSentAt: null }, 'UPCOMING')).toBe(false)
    expect(isAttendanceReportVisibleToClient({ reportSentAt: null }, 'COMPLETED')).toBe(true)
    expect(isAttendanceReportVisibleToClient({ reportSentAt: new Date() }, 'UPCOMING')).toBe(true)
  })
})

describe('clientVisibleReportWhere', () => {
  it('is an OR of "session done" and "released early", never a bare sentAt test', () => {
    expect(clientVisibleReportWhere()).toEqual({
      OR: [
        { session: { status: { in: ['COMPLETED', 'COMMENTED', 'INVOICED'] } } },
        { sentAt: { not: null } },
      ],
    })
  })
})

describe('reportHasContent', () => {
  it('the blank row created by attaching a form is not a recap', () => {
    expect(reportHasContent({ answers: {} })).toBe(false)
    expect(reportHasContent({ answers: {}, introMessage: '', closingMessage: '   ' })).toBe(false)
    expect(reportHasContent({})).toBe(false)
  })

  it('one filled answer is enough', () => {
    expect(reportHasContent({ answers: { q1: 'Rusty nailed the recall' } })).toBe(true)
  })

  it('whitespace is not an answer', () => {
    expect(reportHasContent({ answers: { q1: '   ' } })).toBe(false)
  })

  it('a per-session intro or sign-off on its own counts', () => {
    expect(reportHasContent({ answers: {}, introMessage: 'Great week!' })).toBe(true)
    expect(reportHasContent({ answers: {}, closingMessage: 'See you Tuesday' })).toBe(true)
  })

  it('survives the JSON column being null or the wrong shape', () => {
    expect(reportHasContent({ answers: null })).toBe(false)
    expect(reportHasContent({ answers: 'not an object' })).toBe(false)
    expect(reportHasContent({ answers: ['a'] })).toBe(false)
  })
})

describe('attendanceReportHasContent', () => {
  it('reads the register blob, which nests its answers differently', () => {
    expect(attendanceReportHasContent(null)).toBe(false)
    expect(attendanceReportHasContent({ formId: 'f1', answers: {}, intro: null, closing: null })).toBe(false)
    expect(attendanceReportHasContent({ formId: 'f1', answers: { q1: 'Settled well' } })).toBe(true)
    expect(attendanceReportHasContent({ intro: 'Lovely session' })).toBe(true)
  })

  it('is not fooled by a JSON array or a scalar', () => {
    expect(attendanceReportHasContent(['a'])).toBe(false)
    expect(attendanceReportHasContent('report')).toBe(false)
  })
})
