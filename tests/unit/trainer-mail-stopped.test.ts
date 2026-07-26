import { describe, it, expect, vi, beforeEach } from 'vitest'

// "When someone cancels their trial, cancel their emails."
//
// Three layers, tested here in order:
//   1. trainerMailStopped — the rule itself (pure).
//   2. isTrainerMailStopped — the recipient lookup (prisma mocked).
//   3. sendEmail — the single gate every sender passes through, so a cron that
//      talks to Resend via sendEmail inherits the rule without its own check.
const h = vi.hoisted(() => ({
  userFindFirst: vi.fn(),
  resendSend: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: { user: { findFirst: h.userFindFirst } } }))
vi.mock('@/lib/env', () => ({ env: { RESEND_API_KEY: 'test-key', RESEND_FROM_EMAIL: 'noreply@pupmanager.com' } }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.resendSend }
    batch = { send: vi.fn() }
  },
}))

import { trainerMailStopped } from '@/lib/access'
import { isTrainerMailStopped } from '@/lib/trainer-mail'
import { sendEmail } from '@/lib/email'

const FUTURE = new Date(Date.now() + 7 * 86_400_000)
const PAST = new Date(Date.now() - 86_400_000)

const inTrial = { subscriptionStatus: 'TRIALING' as const, trialEndsAt: FUTURE, stripeSubscriptionId: null }
const cancelled = { subscriptionStatus: 'CANCELLED' as const, trialEndsAt: PAST, stripeSubscriptionId: 'sub_1' }
const lapsed = { subscriptionStatus: 'TRIALING' as const, trialEndsAt: PAST, stripeSubscriptionId: null }

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.resendSend.mockResolvedValue({ data: { id: 'msg_1' }, error: null })
})

describe('trainerMailStopped — who we stop writing to', () => {
  it('keeps mailing a trainer inside their free trial', () => {
    expect(trainerMailStopped(inTrial)).toBe(false)
  })

  it('keeps mailing a paying trainer', () => {
    expect(trainerMailStopped({ subscriptionStatus: 'ACTIVE', trialEndsAt: null, stripeSubscriptionId: 'sub_1' })).toBe(false)
  })

  it('stops when the subscription is cancelled', () => {
    expect(trainerMailStopped(cancelled)).toBe(true)
  })

  it('stops when the free trial ran out with nothing bought', () => {
    expect(trainerMailStopped(lapsed)).toBe(true)
  })

  it('stops on PAST_DUE and INACTIVE too — the same people the paywall locks out', () => {
    expect(trainerMailStopped({ subscriptionStatus: 'PAST_DUE', trialEndsAt: null, stripeSubscriptionId: 'sub_1' })).toBe(true)
    expect(trainerMailStopped({ subscriptionStatus: 'INACTIVE', trialEndsAt: null, stripeSubscriptionId: null })).toBe(true)
  })

  it('stops for a deactivated account even while its subscription is live', () => {
    expect(trainerMailStopped({ subscriptionStatus: 'ACTIVE', trialEndsAt: null, stripeSubscriptionId: 'sub_1', deactivatedAt: PAST })).toBe(true)
  })

  it('an admin grace period restores the mail as well as the access', () => {
    expect(trainerMailStopped({ ...cancelled, gracePeriodUntil: FUTURE })).toBe(false)
    expect(trainerMailStopped({ ...cancelled, gracePeriodUntil: PAST })).toBe(true)
  })
})

describe('isTrainerMailStopped — resolving an address', () => {
  it('is false for an address we have no account for', async () => {
    h.userFindFirst.mockResolvedValue(null)
    expect(await isTrainerMailStopped('stranger@example.com')).toBe(false)
  })

  it('is false for a client (no owned business profile)', async () => {
    h.userFindFirst.mockResolvedValue({ deactivatedAt: null, trainerProfile: null })
    expect(await isTrainerMailStopped('owner@dogs.test')).toBe(false)
  })

  it('is true for a cancelled trainer', async () => {
    h.userFindFirst.mockResolvedValue({ deactivatedAt: null, trainerProfile: cancelled })
    expect(await isTrainerMailStopped('gone@dogs.test')).toBe(true)
  })

  it('never suppresses a multi-recipient internal alert', async () => {
    expect(await isTrainerMailStopped(['karl@pupmanager.com', 'brooke@pupmanager.com'])).toBe(false)
    expect(h.userFindFirst).not.toHaveBeenCalled()
  })

  it('fails OPEN — a database hiccup must not swallow mail', async () => {
    h.userFindFirst.mockRejectedValue(new Error('connection reset'))
    expect(await isTrainerMailStopped('someone@dogs.test')).toBe(false)
  })
})

describe('sendEmail — the gate every sender inherits', () => {
  const message = { to: 'trainer@dogs.test', subject: 'Your week ahead', html: '<p>hi</p>' }

  it('still delivers to a trainer in their trial', async () => {
    h.userFindFirst.mockResolvedValue({ deactivatedAt: null, trainerProfile: inTrial })
    const res = await sendEmail(message)
    expect(h.resendSend).toHaveBeenCalledTimes(1)
    expect(res.error).toBeNull()
  })

  it('holds the message when the trainer has cancelled', async () => {
    h.userFindFirst.mockResolvedValue({ deactivatedAt: null, trainerProfile: cancelled })
    const res = await sendEmail(message)
    expect(h.resendSend).not.toHaveBeenCalled()
    // No error — a caller that only inspects `error` sees a clean send, not a
    // failure to retry.
    expect(res.error).toBeNull()
  })

  it('holds the message when the trial simply lapsed', async () => {
    h.userFindFirst.mockResolvedValue({ deactivatedAt: null, trainerProfile: lapsed })
    await sendEmail(message)
    expect(h.resendSend).not.toHaveBeenCalled()
  })

  it('alwaysSend gets through — verification codes, invites, money alerts, win-backs', async () => {
    h.userFindFirst.mockResolvedValue({ deactivatedAt: null, trainerProfile: cancelled })
    await sendEmail({ ...message, alwaysSend: true })
    expect(h.resendSend).toHaveBeenCalledTimes(1)
    // The escape hatch is not passed on to Resend.
    expect(h.resendSend.mock.calls[0][0]).not.toHaveProperty('alwaysSend')
  })

  it('leaves a client address alone', async () => {
    h.userFindFirst.mockResolvedValue({ deactivatedAt: null, trainerProfile: null })
    await sendEmail({ ...message, to: 'owner@dogs.test' })
    expect(h.resendSend).toHaveBeenCalledTimes(1)
  })
})
