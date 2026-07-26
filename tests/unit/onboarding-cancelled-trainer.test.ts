import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The onboarding/trial drip must drop a trainer who has cancelled or lapsed.
//
// The dispatcher needs its OWN check rather than leaning on sendEmail's gate:
// it writes a TrainerOnboardingEmailLog row after what it thinks was a
// successful send, so a silently-held message would burn that template's one
// chance for a trainer who later comes back.
const h = vi.hoisted(() => ({
  templateFindMany: vi.fn(),
  progressFindMany: vi.fn(),
  logCreate: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    onboardingEmail: { findMany: h.templateFindMany },
    trainerOnboardingProgress: { findMany: h.progressFindMany },
    trainerOnboardingEmailLog: { create: h.logCreate },
  },
}))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, fromTrainer: (n: string) => `${n} via PupManager <noreply@pupmanager.com>` }))

import { runOnboardingEmailDispatch } from '@/lib/onboarding/send-emails'

// 9:30am UTC — inside the send window for a trainer on UTC, so the time-based
// templates are actually evaluated rather than skipped for the hour.
const NOW = new Date('2026-08-01T09:30:00Z')
const STARTED = new Date('2026-07-01T00:00:00Z') // after DRIP_ACTIVATION
const TRIAL_OVER = new Date('2026-07-25T00:00:00Z')

const template = (key: string, triggerRule: unknown) => ({
  key,
  triggerRule,
  subject: 'Subject',
  body: 'Body',
  topText: null,
  imageUrl: null,
  imageHeight: null,
  bottomText: null,
  senderKey: 'karl',
})

const progress = (trainer: Record<string, unknown>) => ({
  id: 'prog-1',
  trainerId: 'trainer-1',
  startedAt: STARTED,
  ahaReachedAt: null,
  firstInviteSentAt: null,
  emails: [],
  trainer: {
    businessName: 'Dog School',
    subscriptionStatus: 'TRIALING',
    trialEndsAt: new Date('2026-08-10T00:00:00Z'),
    stripeSubscriptionId: null,
    gracePeriodUntil: null,
    isInternal: false,
    user: { name: 'Olivia Owner', email: 'olivia@dogs.test', createdAt: STARTED, deactivatedAt: null, timezone: 'UTC' },
    ...trainer,
  },
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  Object.values(h).forEach(fn => fn.mockReset())
  h.sendEmail.mockResolvedValue({ data: { id: 'msg' }, error: null })
  h.logCreate.mockResolvedValue({})
})

afterEach(() => {
  vi.useRealTimers()
})

describe('onboarding drip — a cancelled trainer stops hearing from us', () => {
  it('sends the nudge to a trainer still in their trial', async () => {
    h.templateFindMany.mockResolvedValue([template('day3', { type: 'after_signup', hours: 24 })])
    h.progressFindMany.mockResolvedValue([progress({})])

    const stats = await runOnboardingEmailDispatch()

    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendEmail.mock.calls[0][0].to).toBe('olivia@dogs.test')
    expect(stats.sent).toBe(1)
  })

  it('sends nothing to a cancelled trainer — and logs nothing', async () => {
    h.templateFindMany.mockResolvedValue([template('day3', { type: 'after_signup', hours: 24 })])
    h.progressFindMany.mockResolvedValue([
      progress({ subscriptionStatus: 'CANCELLED', trialEndsAt: TRIAL_OVER, stripeSubscriptionId: 'sub_1' }),
    ])

    const stats = await runOnboardingEmailDispatch()

    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.logCreate).not.toHaveBeenCalled()
    expect(stats.sent).toBe(0)
    expect(stats.skipped).toBe(1)
  })

  it('sends nothing once a free trial has run out', async () => {
    h.templateFindMany.mockResolvedValue([template('day3', { type: 'after_signup', hours: 24 })])
    h.progressFindMany.mockResolvedValue([progress({ trialEndsAt: TRIAL_OVER })])

    await runOnboardingEmailDispatch()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('still sends the win-back to a lapsed free trial', async () => {
    h.templateFindMany.mockResolvedValue([template('trial-over', { type: 'trial_ended' })])
    h.progressFindMany.mockResolvedValue([progress({ trialEndsAt: TRIAL_OVER })])

    await runOnboardingEmailDispatch()

    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    // Marked so the gate in sendEmail lets it past too.
    expect(h.sendEmail.mock.calls[0][0].alwaysSend).toBe(true)
  })

  it('does NOT send the win-back to someone who actively cancelled', async () => {
    h.templateFindMany.mockResolvedValue([template('trial-over', { type: 'trial_ended' })])
    h.progressFindMany.mockResolvedValue([
      progress({ subscriptionStatus: 'CANCELLED', trialEndsAt: TRIAL_OVER, stripeSubscriptionId: 'sub_1' }),
    ])

    await runOnboardingEmailDispatch()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('an admin grace period puts a cancelled trainer back on the list', async () => {
    h.templateFindMany.mockResolvedValue([template('day3', { type: 'after_signup', hours: 24 })])
    h.progressFindMany.mockResolvedValue([
      progress({
        subscriptionStatus: 'CANCELLED',
        trialEndsAt: TRIAL_OVER,
        gracePeriodUntil: new Date('2026-09-01T00:00:00Z'),
      }),
    ])

    await runOnboardingEmailDispatch()
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('keeps mailing a paying trainer', async () => {
    h.templateFindMany.mockResolvedValue([template('day3', { type: 'after_signup', hours: 24 })])
    h.progressFindMany.mockResolvedValue([
      progress({ subscriptionStatus: 'ACTIVE', trialEndsAt: null, stripeSubscriptionId: 'sub_1' }),
    ])

    await runOnboardingEmailDispatch()
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })
})
