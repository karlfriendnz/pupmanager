import { describe, it, expect } from 'vitest'
import {
  audienceEnum,
  channelsForAudience,
  normalizeStepChannels,
  commsTimelinePos,
  sortStepsByTime,
  type Channel,
} from '@/lib/comms-flow-steps'

// The two rules the comms-flow screen and its routes both depend on:
//   • in-app is a STAFF-only channel
//   • a flow is read in the order it will actually happen

describe('audience', () => {
  it('accepts the staff audience', () => {
    expect(audienceEnum.safeParse('STAFF').success).toBe(true)
  })
})

describe('channelsForAudience', () => {
  it('drops in-app from a client-facing step', () => {
    expect(channelsForAudience(['PUSH', 'IN_APP', 'EMAIL'] as Channel[], 'ENROLLED')).toEqual(['PUSH', 'EMAIL'])
  })

  it('keeps in-app for a staff step', () => {
    expect(channelsForAudience(['PUSH', 'IN_APP'] as Channel[], 'STAFF')).toEqual(['PUSH', 'IN_APP'])
  })

  it('never leaves a client step with no way to send', () => {
    expect(channelsForAudience(['IN_APP'] as Channel[], 'ENROLLED')).toEqual(['PUSH'])
  })

  it('leaves email-only alone', () => {
    expect(channelsForAudience(['EMAIL'] as Channel[], 'CUSTOM')).toEqual(['EMAIL'])
  })
})

describe('normalizeStepChannels', () => {
  it('re-checks the channels when only the audience changes', () => {
    const out = normalizeStepChannels({ audience: 'ENROLLED' as const }, 'STAFF', ['PUSH', 'IN_APP'])
    expect(out.channels).toEqual(['PUSH'])
  })

  it('re-checks the audience when only the channels change', () => {
    const out = normalizeStepChannels({ channels: ['EMAIL', 'IN_APP'] as Channel[] }, 'STAFF', ['PUSH'])
    expect(out.channels).toEqual(['EMAIL', 'IN_APP']) // still a staff step
  })

  it('leaves a patch that touches neither untouched', () => {
    const patch = { title: 'x' } as { title: string }
    expect(normalizeStepChannels(patch, 'ENROLLED', ['PUSH', 'IN_APP'])).toBe(patch)
  })
})

describe('sortStepsByTime', () => {
  it('reads a session flow earliest-before → after', () => {
    const steps = [
      { id: 'a', direction: 'AFTER_SESSION', offsetMinutes: 120 },
      { id: 'b', direction: 'BEFORE_SESSION', offsetMinutes: 15 },
      { id: 'c', direction: 'BEFORE_SESSION', offsetMinutes: 10080 },
      { id: 'd', direction: 'AFTER_SESSION', offsetMinutes: 30 },
    ]
    expect(sortStepsByTime(steps).map(s => s.id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('puts a membership welcome before its renewal reminder', () => {
    const steps = [
      { id: 'renew', direction: 'BEFORE_PERIOD_END', offsetMinutes: 4320 },
      { id: 'day7', direction: 'AFTER_PURCHASE', offsetMinutes: 10080 },
      { id: 'welcome', direction: 'AFTER_PURCHASE', offsetMinutes: 0 },
    ]
    expect(sortStepsByTime(steps).map(s => s.id)).toEqual(['welcome', 'day7', 'renew'])
  })

  it('breaks a tie on the authored order, not on chance', () => {
    const steps = [
      { id: 'second', direction: 'BEFORE_SESSION', offsetMinutes: 60, order: 5 },
      { id: 'first', direction: 'BEFORE_SESSION', offsetMinutes: 60, order: 1 },
    ]
    expect(sortStepsByTime(steps).map(s => s.id)).toEqual(['first', 'second'])
  })

  it('does not mutate the array it was given', () => {
    const steps = [
      { id: 'a', direction: 'AFTER_SESSION', offsetMinutes: 5 },
      { id: 'b', direction: 'BEFORE_SESSION', offsetMinutes: 5 },
    ]
    sortStepsByTime(steps)
    expect(steps.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('a longer lead time is always earlier', () => {
    expect(commsTimelinePos({ direction: 'BEFORE_SESSION', offsetMinutes: 10080 }))
      .toBeLessThan(commsTimelinePos({ direction: 'BEFORE_SESSION', offsetMinutes: 15 }))
  })
})
