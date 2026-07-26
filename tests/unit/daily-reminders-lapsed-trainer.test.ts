import { describe, it, expect, vi, beforeEach } from 'vitest'

// GET /api/cron/daily-reminders emails a trainer's CLIENTS about unfinished
// homework. It talks to Resend directly rather than going through sendEmail(),
// so it does NOT inherit the trainerMailStopped() guard that stops mail to
// lapsed trainers — the guard has to be applied here explicitly.
//
// Karl's call (2026-07-27): when a trainer's subscription lapses, their clients
// stop getting these. The homework is the trainer's programme, sent under their
// business name; a trainer who can't open the app can't act on any of it.

const h = vi.hoisted(() => ({ findMany: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { clientProfile: { findMany: h.findMany } } }))
vi.mock('resend', () => ({
  Resend: class { emails = { send: h.send } },
}))

import { GET } from '@/app/api/cron/daily-reminders/route'

const SECRET = 'cron-secret-abcdef123456'
const authed = () =>
  new Request('http://x/api/cron/daily-reminders', { headers: { authorization: `Bearer ${SECRET}` } })

const DAY = 24 * 60 * 60 * 1000

/** A client with one unfinished task today, whose trainer is in `trainer`. */
const client = (trainer: Record<string, unknown>, email = 'owner@example.com') => ({
  user: { email, name: 'Sam Owner', timezone: 'Pacific/Auckland' },
  trainer: {
    businessName: 'Waggy Tails',
    subscriptionStatus: 'ACTIVE',
    trialEndsAt: null,
    stripeSubscriptionId: 'sub_1',
    gracePeriodUntil: null,
    // deactivatedAt lives on User, not TrainerProfile — a deactivated account
    // is a deactivated person.
    user: { deactivatedAt: null },
    ...trainer,
  },
  diaryEntries: [{ id: 'd1', title: 'Loose lead practice', completion: null }],
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  process.env.RESEND_API_KEY = 're_test'
  process.env.RESEND_FROM_EMAIL = 'hello@pupmanager.test'
  h.send.mockResolvedValue({})
})

describe('daily homework reminders — lapsed trainers', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await GET(new Request('http://x/api/cron/daily-reminders'))
    expect(res.status).toBe(401)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('emails clients of a paying trainer', async () => {
    h.findMany.mockResolvedValue([client({})])
    const res = await GET(authed())
    const body = await res.json()
    expect(body.sent).toBe(1)
    expect(body.skippedLapsed).toBe(0)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('does NOT email clients of a cancelled trainer', async () => {
    h.findMany.mockResolvedValue([client({ subscriptionStatus: 'CANCELLED', stripeSubscriptionId: null })])
    const body = await (await GET(authed())).json()
    expect(h.send).not.toHaveBeenCalled()
    expect(body.sent).toBe(0)
    expect(body.skippedLapsed).toBe(1)
  })

  it('does NOT email clients of a trainer whose trial expired without a subscription', async () => {
    h.findMany.mockResolvedValue([client({
      subscriptionStatus: 'TRIALING', stripeSubscriptionId: null, trialEndsAt: new Date(Date.now() - DAY),
    })])
    const body = await (await GET(authed())).json()
    expect(h.send).not.toHaveBeenCalled()
    expect(body.skippedLapsed).toBe(1)
  })

  it('does NOT email clients of a deactivated trainer, even while paying', async () => {
    h.findMany.mockResolvedValue([client({ subscriptionStatus: 'ACTIVE', user: { deactivatedAt: new Date() } })])
    const body = await (await GET(authed())).json()
    expect(h.send).not.toHaveBeenCalled()
    expect(body.skippedLapsed).toBe(1)
  })

  it('still emails during an admin grace period', async () => {
    // The grace period is the deliberate override — an admin has said "keep
    // this account working"; their clients should not go quiet.
    h.findMany.mockResolvedValue([client({
      subscriptionStatus: 'PAST_DUE', stripeSubscriptionId: null,
      gracePeriodUntil: new Date(Date.now() + 7 * DAY),
    })])
    const body = await (await GET(authed())).json()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(body.sent).toBe(1)
  })

  it('a lapsed trainer never blocks a paying one in the same batch', async () => {
    h.findMany.mockResolvedValue([
      client({ subscriptionStatus: 'CANCELLED', stripeSubscriptionId: null }, 'lapsed@example.com'),
      client({}, 'paying@example.com'),
    ])
    const body = await (await GET(authed())).json()
    expect(body.sent).toBe(1)
    expect(body.skippedLapsed).toBe(1)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][0].to).toBe('paying@example.com')
  })
})
