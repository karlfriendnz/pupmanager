import { describe, it, expect } from 'vitest'
import {
  runKind,
  runKindLabel,
  runHref,
  runSessionHref,
  isOneOffEventPackage,
  type RunKindPackage,
} from '@/lib/run-kind'

// One ClassRun model backs four sections of the app. Every caller that derived
// "which section is this?" locally eventually got it wrong — /sessions/[id] and
// the schedule grid both sent casual, event and daycare sessions to /classes/…
// These lock the derivation down.

const CLASS: RunKindPackage = {
  isGroup: true, allowDropIn: false, sessionCount: 6,
  recurrenceRule: null, isPuppySchool: false,
}
const CASUAL: RunKindPackage = { ...CLASS, allowDropIn: true, sessionCount: 1 }
const EVENT: RunKindPackage = { ...CLASS, sessionCount: 1 }
const DAYCARE: RunKindPackage = { ...CLASS, isPuppySchool: true }

describe('runKind', () => {
  it('names each of the four kinds', () => {
    expect(runKind(CLASS)).toBe('class')
    expect(runKind(CASUAL)).toBe('casual')
    expect(runKind(EVENT)).toBe('event')
    expect(runKind(DAYCARE)).toBe('daycare')
  })

  it('puts daycare first — a puppy-school run can also match the event shape', () => {
    const daycareShapedLikeAnEvent: RunKindPackage = {
      ...EVENT, isPuppySchool: true,
    }
    expect(isOneOffEventPackage(daycareShapedLikeAnEvent)).toBe(true)
    expect(runKind(daycareShapedLikeAnEvent)).toBe('daycare')
  })

  it('a recurring single-session group run is a class, not an event', () => {
    expect(runKind({ ...EVENT, recurrenceRule: 'FREQ=WEEKLY' })).toBe('class')
  })

  it('a one-off drop-in is casual, not an event (an event is never drop-in)', () => {
    expect(runKind({ ...EVENT, allowDropIn: true })).toBe('casual')
  })

  it('labels read the way a trainer would say them', () => {
    expect(runKindLabel(CLASS)).toBe('Class')
    expect(runKindLabel(CASUAL)).toBe('Casual class')
    expect(runKindLabel(EVENT)).toBe('Event')
    expect(runKindLabel(DAYCARE)).toBe('Daycare')
  })
})

describe('runHref', () => {
  it('sends each kind to its own section', () => {
    expect(runHref('r1', CLASS)).toBe('/classes/r1')
    expect(runHref('r1', CASUAL)).toBe('/casual-classes/r1')
    expect(runHref('r1', EVENT)).toBe('/events/r1')
    expect(runHref('r1', DAYCARE)).toBe('/doggy-daycare/r1')
  })
})

describe('runSessionHref', () => {
  it('keeps a session inside its own section', () => {
    expect(runSessionHref('r1', 's1', CLASS)).toBe('/classes/r1/sessions/s1')
    expect(runSessionHref('r1', 's1', CASUAL)).toBe('/casual-classes/r1/sessions/s1')
    expect(runSessionHref('r1', 's1', DAYCARE)).toBe('/doggy-daycare/r1/sessions/s1')
  })

  it('sends an event to its run page — an event has no per-session screen', () => {
    // /events/[eventId] IS the session: an event is one session by definition,
    // and there is no /events/[id]/sessions/[id] route to land on.
    expect(runSessionHref('r1', 's1', EVENT)).toBe('/events/r1')
  })
})
