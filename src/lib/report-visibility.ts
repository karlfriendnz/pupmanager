import type { Prisma } from '@/generated/prisma'

// When a client is allowed to read the write-up of their session.
//
// ── The rule ─────────────────────────────────────────────────────────────────
//
// Marking the session complete IS publishing the write-up. There is no second
// "send" step to remember, because a trainer who has ticked the session off has
// already said the thing that matters: this happened, and here is what we did.
//
// Before this, a saved write-up sat as a DRAFT until the trainer went to a
// separate screen and pressed Send. That is one action too many for something
// the trainer thought they had already finished — they wrote the notes, the
// screen showed them back, and the client saw nothing. Karl's words: "I should
// not have to send something for the client to see session notes."
//
// So visibility is:
//
//   the session is done  OR  the trainer explicitly sent it
//
// The second half is not legacy baggage. `sentAt` / `reportSentAt` still mean
// something precise — "this client has been told" — and they are the only
// defence against notifying the same person twice about the same recap. Keeping
// them in the visibility test also means nothing a client could already read is
// taken back off them: a note that was sent on a session nobody ever marked
// complete stays readable.
//
// ── Why session status and not "the session has run" ─────────────────────────
//
// lib/homework-visibility uses `status ∈ DONE  OR  scheduledAt <= now`, because
// a missing tick must never be able to hide homework the client needs. A recap
// is the opposite case. It is the trainer's writing, and a trainer part-way
// through a write-up on last Tuesday's session needs it to stay theirs until
// they say otherwise. Status is a deliberate act; the clock is not. So the
// clock is deliberately NOT part of this rule, and "don't mark it complete yet"
// is how a trainer holds a half-written note back.
//
// ── What this leaves for privacy ─────────────────────────────────────────────
//
// Per-QUESTION privacy is untouched: a question flagged `isPrivate` is filtered
// out of the client's view no matter what (see components/shared/session-report).
// That is the tool for "this bit is for me". What has gone is holding a whole
// finished-and-complete session's write-up back indefinitely — the session's
// status is now that switch, and it can be rolled back to Upcoming.
//
// This is the ONE definition. If you find yourself writing `sentAt: { not: null }`
// against a client-facing read of a recap anywhere else, use this instead.

/** Session statuses that mean the trainer considers the session done. */
export const SESSION_DONE_STATUSES = ['COMPLETED', 'COMMENTED', 'INVOICED'] as const

export type SessionDoneStatus = (typeof SESSION_DONE_STATUSES)[number]

/** Has the trainer called this session done? */
export function isSessionDone(status: string | null | undefined): boolean {
  return SESSION_DONE_STATUSES.includes(status as SessionDoneStatus)
}

/**
 * A `SessionFormResponse` where-fragment for client-facing reads. Spread into
 * an existing where clause, or use it as the body of a `some:` filter:
 *
 * ```ts
 * formResponses: { some: clientVisibleReportWhere() }
 * ```
 *
 * Trainer-side reads must NOT use this — a trainer sees their own drafts, which
 * is the entire point of being able to write one before ticking the session off.
 */
export function clientVisibleReportWhere(): Prisma.SessionFormResponseWhereInput {
  return {
    OR: [
      { session: { status: { in: [...SESSION_DONE_STATUSES] } } },
      { sentAt: { not: null } },
    ],
  }
}

/**
 * The same rule applied to a row already in hand — for the pages that loaded
 * the session first and filter its `include`d responses in memory. Passing the
 * status separately (rather than joining the session back onto the response) is
 * deliberate: the caller always has it, and a self-join to answer a question
 * about the row you are already inside reads as a mistake.
 */
export function isReportVisibleToClient(
  response: { sentAt: Date | string | null },
  sessionStatus: string | null | undefined,
): boolean {
  if (response.sentAt != null) return true
  return isSessionDone(sessionStatus)
}

/**
 * Group-class per-attendee reports. Same rule, same reasoning, different two
 * columns: the write-up lives on the attendance row as JSON, and its "the
 * client has been told" stamp is `reportSentAt`.
 */
export function isAttendanceReportVisibleToClient(
  attendance: { reportSentAt: Date | string | null },
  sessionStatus: string | null | undefined,
): boolean {
  if (attendance.reportSentAt != null) return true
  return isSessionDone(sessionStatus)
}

/**
 * Does this write-up actually say anything?
 *
 * Attaching a form to a session writes an EMPTY response row immediately, so
 * "a response exists" has never meant "a recap exists". Under the old rule
 * `sentAt` stood in for that — you cannot send nothing. Now that completing a
 * session reveals whatever is there, the emptiness has to be tested directly,
 * or every completed session would announce a recap that turns out to be blank.
 */
export function reportHasContent(response: {
  answers?: unknown
  introMessage?: string | null
  closingMessage?: string | null
}): boolean {
  if ((response.introMessage ?? '').trim() !== '') return true
  if ((response.closingMessage ?? '').trim() !== '') return true
  return hasAnyAnswer(response.answers)
}

/**
 * The attendance-row equivalent. Its report is a JSON blob written by the
 * register — `{ formId, answers, intro, closing }` — so the same question has
 * to be asked of a different shape.
 */
export function attendanceReportHasContent(report: unknown): boolean {
  if (report == null || typeof report !== 'object' || Array.isArray(report)) return false
  const r = report as { answers?: unknown; intro?: unknown; closing?: unknown }
  if (typeof r.intro === 'string' && r.intro.trim() !== '') return true
  if (typeof r.closing === 'string' && r.closing.trim() !== '') return true
  return hasAnyAnswer(r.answers)
}

function hasAnyAnswer(answers: unknown): boolean {
  if (answers == null || typeof answers !== 'object' || Array.isArray(answers)) return false
  return Object.values(answers as Record<string, unknown>).some(v => {
    if (typeof v === 'string') return v.trim() !== ''
    if (Array.isArray(v)) return v.length > 0
    return v != null
  })
}
