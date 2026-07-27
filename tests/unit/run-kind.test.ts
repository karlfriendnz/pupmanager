import { describe, it, expect } from 'vitest'
import {
  runKind,
  runKindLabel,
  runHref,
  runSessionHref,
  isEventPackage,
  type RunKindPackage,
} from '@/lib/run-kind'

// One ClassRun model backs four sections of the app. Every caller that derived
// "which section is this?" locally eventually got it wrong — /sessions/[id] and
// the schedule grid both sent casual, event and daycare sessions to /classes/…
// These lock the derivation down.

const CLASS: RunKindPackage = { isEvent: false, allowDropIn: false, isPuppySchool: false }
const CASUAL: RunKindPackage = { ...CLASS, allowDropIn: true }
const EVENT: RunKindPackage = { ...CLASS, isEvent: true }
const DAYCARE: RunKindPackage = { ...CLASS, isPuppySchool: true }

describe('runKind', () => {
  it('names each of the four kinds', () => {
    expect(runKind(CLASS)).toBe('class')
    expect(runKind(CASUAL)).toBe('casual')
    expect(runKind(EVENT)).toBe('event')
    expect(runKind(DAYCARE)).toBe('daycare')
  })

  it('puts daycare first — a daycare programme flagged as an event is still daycare', () => {
    const daycareFlaggedAsEvent: RunKindPackage = { ...EVENT, isPuppySchool: true }
    expect(isEventPackage(daycareFlaggedAsEvent)).toBe(true)
    expect(runKind(daycareFlaggedAsEvent)).toBe('daycare')
  })

  // The bug this file exists to prevent a repeat of: "event" used to be a
  // SHAPE — a group offering with one session and no recurrence — and an
  // ordinary class that runs once matched it exactly, so it vanished off the
  // trainer's Classes list and turned up under Events. The kind is DECLARED
  // now, and nothing about how often a class meets can change it.
  it('a class that runs once is still a class', () => {
    expect(runKind(CLASS)).toBe('class')
    expect(isEventPackage(CLASS)).toBe(false)
    expect(runHref('r1', CLASS)).toBe('/classes/r1')
  })

  // Contradictory flags can't be created — the packages API refuses to mark a
  // drop-in or a daycare programme as an event — but if one ever existed the
  // declaration wins, and it wins the same way in the list queries (/classes
  // and /casual-classes both exclude events), so it can't appear twice.
  it('the declared kind wins over the drop-in flag', () => {
    expect(runKind({ ...EVENT, allowDropIn: true })).toBe('event')
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
