import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// Notifications reaching the wrong person, or at the wrong moment, is the
// failure mode that costs a trainer their client's trust. These lock the guards
// that stop it. They read the cron sources because the routes are request-
// scoped handlers whose sends happen behind push/email clients — what CAN be
// pinned is the filtering that decides who is even considered.

const reminderCrons = [
  'src/app/api/cron/session-reminders/route.ts',        // → the trainer
  'src/app/api/cron/client-session-reminders/route.ts', // → the client
]

describe('reminder crons never announce the wrong thing', () => {
  it.each(reminderCrons)('%s skips demo/sample data', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain('client: { isSample: true }')
    expect(src).toContain('classRun: { isSample: true }')
  })

  // The live bug: cancelling a class sets the RUN to CANCELLED but leaves its
  // sessions UPCOMING, so both crons went on reminding about a class that
  // wasn't happening. Found on a paying customer with a client still enrolled.
  it.each(reminderCrons)('%s skips sessions on a CANCELLED class', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain("classRun: { status: 'CANCELLED' }")
  })

  it.each(reminderCrons)('%s only considers UPCOMING sessions', (file) => {
    const src = readFileSync(file, 'utf8')
    expect(src).toContain("status: 'UPCOMING'")
  })

  // Without this the cron would re-announce the same session on every tick.
  it('the trainer reminder is guarded against sending twice', () => {
    const src = readFileSync(reminderCrons[0], 'utf8')
    expect(src).toContain('reminderPushSentAt')
    expect(src).toContain('notesReminderPushSentAt')
  })

  // The SQL has no lower bound on scheduledAt, so the in-code window is the
  // ONLY thing stopping a pile of stale past sessions firing at once. There
  // were 235 such sessions in production when this was written.
  it('only fires inside the lead window, and never for a session already started', () => {
    const src = readFileSync(reminderCrons[0], 'utf8')
    expect(src).toContain('minutesUntilStart > 0')
    expect(src).toContain('minutesUntilEnd > 0')
    expect(src).toMatch(/Math\.abs\(minutesUntil(Start|End) - lead\) <= TICK_INTERVAL_MIN \/ 2/)
  })
})

describe('the window maths', () => {
  const TICK = 10
  const inWindow = (minutesUntil: number, lead: number) =>
    minutesUntil > 0 && Math.abs(minutesUntil - lead) <= TICK / 2

  it('fires once around the lead time', () => {
    expect(inWindow(20, 20)).toBe(true)
    expect(inWindow(17, 20)).toBe(true)
    expect(inWindow(23, 20)).toBe(true)
  })

  it('does not fire early', () => {
    expect(inWindow(40, 20)).toBe(false)
    expect(inWindow(26, 20)).toBe(false)
  })

  // A session that already started must never page anyone — this is what holds
  // back the stale-UPCOMING backlog.
  it('never fires for a session in the past', () => {
    expect(inWindow(0, 20)).toBe(false)
    expect(inWindow(-5, 20)).toBe(false)
    expect(inWindow(-20, 20)).toBe(false)
    expect(inWindow(-100000, 20)).toBe(false)
  })
})
