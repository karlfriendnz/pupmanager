import { describe, it, expect } from 'vitest'
import {
  MAX_BUFFER_MINS,
  normalizeBufferMins,
  effectiveBufferMins,
  occupiedMins,
  occupiedEndMs,
  bufferedOverlap,
} from '@/lib/buffer'
import { overlapsBusy, enumerateStartTimes, type BusyInterval } from '@/lib/availability'
import { generateBookingSlots } from '@/lib/booking-slots'
import { findDropClashes } from '@/lib/use-booking-conflicts'

// The "gap before the next session" buffer. The one rule everything below is
// testing: a session OCCUPIES [start, start + duration + buffer), half-open —
// so a booking that starts exactly when the buffer ENDS is allowed, and one
// that starts a minute earlier is not.

const DATE = '2030-01-08' // a Tuesday
const dateSlot = (startTime: string, endTime: string) => ({
  id: 's', dayOfWeek: null, date: DATE, startTime, endTime,
})

describe('buffer helpers', () => {
  it('normalises junk to a sane whole number of minutes', () => {
    expect(normalizeBufferMins(undefined)).toBe(0)
    expect(normalizeBufferMins(null)).toBe(0)
    expect(normalizeBufferMins(-15)).toBe(0)
    expect(normalizeBufferMins(30.7)).toBe(30)
    expect(normalizeBufferMins(NaN)).toBe(0)
    expect(normalizeBufferMins(10_000)).toBe(MAX_BUFFER_MINS)
  })

  it('lets a class run override its package, and inherits when it does not', () => {
    expect(effectiveBufferMins(45, 30)).toBe(45)   // run override wins
    expect(effectiveBufferMins(null, 30)).toBe(30) // null = inherit the package
    expect(effectiveBufferMins(undefined, 30)).toBe(30)
    expect(effectiveBufferMins(0, 30)).toBe(0)     // an explicit 0 is NOT "inherit"
    expect(effectiveBufferMins(null, null)).toBe(0)
  })

  it('occupies duration + buffer', () => {
    expect(occupiedMins(60, 30)).toBe(90)
    expect(occupiedMins(60, 0)).toBe(60)
    const tenAm = new Date('2030-01-08T10:00:00Z').getTime()
    expect(occupiedEndMs(tenAm, 60, 30)).toBe(new Date('2030-01-08T11:30:00Z').getTime())
  })

  describe('bufferedOverlap — the 10:00–11:00 + 30min boundary', () => {
    const existing = { startMs: new Date('2030-01-08T10:00:00Z').getTime(), durationMins: 60, bufferMins: 30 }
    const at = (iso: string, durationMins = 60, bufferMins = 0) => ({
      startMs: new Date(iso).getTime(), durationMins, bufferMins,
    })

    it('ALLOWS a booking that starts exactly when the buffer ends (11:30)', () => {
      expect(bufferedOverlap(at('2030-01-08T11:30:00Z'), existing)).toBe(false)
    })

    it('REJECTS a booking one minute earlier (11:29) — it lands in the buffer', () => {
      expect(bufferedOverlap(at('2030-01-08T11:29:00Z'), existing)).toBe(true)
    })

    it('REJECTS a booking at 11:00 — the session ends, but the buffer has not', () => {
      expect(bufferedOverlap(at('2030-01-08T11:00:00Z'), existing)).toBe(true)
    })

    it('ALLOWS 11:00 when the existing session has no buffer', () => {
      expect(bufferedOverlap(at('2030-01-08T11:00:00Z'), { ...existing, bufferMins: 0 })).toBe(false)
    })

    it("REJECTS a booking BEFORE it whose OWN buffer would run into it (09:00 + 60m + 30m ⇒ 10:30)", () => {
      expect(bufferedOverlap(at('2030-01-08T09:00:00Z', 60, 30), existing)).toBe(true)
    })

    it('ALLOWS that same earlier booking when its own buffer stops exactly at 10:00', () => {
      expect(bufferedOverlap(at('2030-01-08T08:30:00Z', 60, 30), existing)).toBe(false)
    })
  })
})

describe('overlapsBusy (client self-book guard)', () => {
  // 10:00–11:00 with a 30-minute buffer ⇒ blocked until 11:30.
  const busy: BusyInterval[] = [{ dateStr: DATE, startMin: 600, endMin: 660, bufferMins: 30 }]

  it('allows a 60-min session starting exactly at 11:30', () => {
    expect(overlapsBusy(busy, DATE, 690, 60)).toBe(false)
  })

  it('rejects one starting at 11:29', () => {
    expect(overlapsBusy(busy, DATE, 689, 60)).toBe(true)
  })

  it('rejects one starting at 11:00 (inside the buffer)', () => {
    expect(overlapsBusy(busy, DATE, 660, 60)).toBe(true)
  })

  it('counts the PROPOSED session’s own buffer too', () => {
    // 08:30–09:30 + 30m buffer ⇒ occupies to 10:00: fine, butts up exactly.
    expect(overlapsBusy(busy, DATE, 510, 60, 30)).toBe(false)
    // 08:31 ⇒ its buffer runs to 10:01, one minute into the existing session.
    expect(overlapsBusy(busy, DATE, 511, 60, 30)).toBe(true)
  })

  it('ignores buffers on another day', () => {
    expect(overlapsBusy(busy, '2030-01-09', 660, 60)).toBe(false)
  })
})

describe('enumerateStartTimes (self-book picker)', () => {
  it('drops every start inside an existing booking’s buffer, and offers the one at its end', () => {
    const busy: BusyInterval[] = [{ dateStr: DATE, startMin: 600, endMin: 660, bufferMins: 30 }]
    const times = enumerateStartTimes([dateSlot('09:00', '13:00')], DATE, 60, [], 30, busy)
    // 09:00 ok (09:00–10:00). 09:30, 10:00, 10:30, 11:00 all clash with the
    // session or its buffer. 11:30 is the first clean start again.
    expect(times).toEqual(['09:00', '11:30', '12:00'])
  })

  it('applies the proposed package’s OWN buffer as well', () => {
    const busy: BusyInterval[] = [{ dateStr: DATE, startMin: 600, endMin: 660 }] // 10:00–11:00, no buffer
    const times = enumerateStartTimes([dateSlot('08:00', '12:00')], DATE, 60, [], 30, busy, 30)
    // A 60-min session with a 30-min gap occupies 90 min: 08:00 (→09:30) and
    // 08:30 (→10:00) are fine; 09:00 (→10:30) runs into the 10:00 session.
    // 11:00 is the last start that still fits the 60-min SESSION inside the
    // 08:00–12:00 window — the buffer itself may spill past the window (it's
    // the trainer's own reset time, not client-facing).
    expect(times).toEqual(['08:00', '08:30', '11:00'])
  })
})

describe('generateBookingSlots (public booking page)', () => {
  const base = {
    tz: 'UTC',
    todayStr: DATE,
    windowDays: 1,
    slotLengthMins: 60,
    slotIntervalMins: 30,
    minNoticeHours: 0,
    slots: [dateSlot('09:00', '13:00')],
    blackouts: [],
    now: new Date('2030-01-01T00:00:00Z'),
  }

  it('does not offer a slot inside an existing session’s buffer', () => {
    const days = generateBookingSlots({
      ...base,
      // 10:00–11:00 + 30-min buffer ⇒ nothing bookable until 11:30.
      busyByDate: new Map([[DATE, [{ start: 600, end: 660, buffer: 30 }]]]),
    })
    const labels = days[0].slots.map(s => s.startMin)
    expect(labels).toContain(540)      // 09:00
    expect(labels).not.toContain(660)  // 11:00 — in the buffer
    expect(labels).not.toContain(689)  // 11:29 (not on the grid anyway)
    expect(labels).toContain(690)      // 11:30 — exactly when the buffer ends
  })

  it('applies the page package’s own buffer to each candidate slot', () => {
    const days = generateBookingSlots({
      ...base,
      slotBufferMins: 30,
      busyByDate: new Map([[DATE, [{ start: 660, end: 720 }]]]), // 11:00–12:00
    })
    const starts = days[0].slots.map(s => s.startMin)
    expect(starts).toContain(570)     // 09:30 → ends 10:30, buffer to 11:00: OK
    expect(starts).not.toContain(600) // 10:00 → buffer runs to 11:30, into the session
  })
})

describe('findDropClashes (drag-drop on the schedule)', () => {
  const owner = 'm-owner'
  const existing = [{
    id: 'e1',
    title: 'Bailey — session 2/6',
    scheduledAt: '2030-01-08T10:00:00.000Z',
    durationMins: 60,
    bufferMins: 30, // occupied until 11:30
    assignedMembershipId: owner,
  }]
  const drop = (iso: string, bufferMins = 0) => [{
    id: 'dragged', scheduledAt: iso, durationMins: 60, bufferMins, assignedMembershipId: owner,
  }]

  it('flags a drop at 11:00 — inside the existing session’s buffer', () => {
    expect(findDropClashes(drop('2030-01-08T11:00:00.000Z'), existing, owner)).toHaveLength(1)
  })

  it('allows a drop at exactly 11:30', () => {
    expect(findDropClashes(drop('2030-01-08T11:30:00.000Z'), existing, owner)).toHaveLength(0)
  })

  it('flags a drop at 11:29', () => {
    expect(findDropClashes(drop('2030-01-08T11:29:00.000Z'), existing, owner)).toHaveLength(1)
  })

  it('keeps per-person scoping: another member at the same time is not a clash', () => {
    const other = [{ id: 'dragged', scheduledAt: '2030-01-08T11:00:00.000Z', durationMins: 60, bufferMins: 0, assignedMembershipId: 'm-other' }]
    expect(findDropClashes(other, existing, owner)).toHaveLength(0)
  })
})
