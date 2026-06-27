import { describe, it, expect, vi, beforeEach } from 'vitest'

// Public lead-magnet sign-up. Security/behaviour focus: rate-limit, required
// consent, add-on + active gating, subscriber upsert with a consent snapshot,
// and that the download email is sent. Prisma/email/rate-limit are mocked.
const h = vi.hoisted(() => ({
  trainerFindUnique: vi.fn(),
  subscriberUpsert: vi.fn(),
  hasAddon: vi.fn(),
  enforceRateLimit: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    subscriber: { upsert: h.subscriberUpsert },
  },
}))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: h.enforceRateLimit, getClientIp: () => '1.2.3.4' }))
vi.mock('@/lib/email', () => ({ sendEmail: h.sendEmail, fromTrainer: (n: string) => `${n} via PupManager <noreply@pupmanager.com>` }))
vi.mock('@/lib/lead-magnet-email', () => ({ buildLeadMagnetEmail: () => ({ subject: 's', html: '<p>h</p>', text: 't' }) }))
vi.mock('@/lib/subscriber-unsubscribe-token', () => ({ subscriberUnsubscribeUrl: (id: string) => `https://app/unsub/${id}` }))

import { POST } from '@/app/api/c/[slug]/free/[magnetSlug]/route'

const params = Promise.resolve({ slug: 'pawsome', magnetSlug: 'puppy-tips' })
function req(body: unknown) {
  return new Request('http://localhost/c/pawsome/free/puppy-tips', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
function seedTrainer() {
  h.trainerFindUnique.mockResolvedValue({
    id: 't-1', businessName: 'Pawsome', logoUrl: null, emailAccentColor: null,
    user: { name: 'Sam', email: 'sam@pawsome.test' },
    leadMagnets: [{ id: 'lm-1', title: 'Puppy tips', fileUrl: 'https://blob/x.pdf', consentText: 'I agree.' }],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.enforceRateLimit.mockResolvedValue(null) // not limited
  h.hasAddon.mockResolvedValue(true)
  h.subscriberUpsert.mockResolvedValue({ id: 'sub-1' })
  h.sendEmail.mockResolvedValue(undefined)
})

describe('POST /c/[slug]/free/[magnetSlug]', () => {
  it('honours the rate limiter', async () => {
    const { NextResponse } = await import('next/server')
    h.enforceRateLimit.mockResolvedValue(NextResponse.json({ error: 'Too many' }, { status: 429 }))
    const res = await POST(req({ name: 'A', email: 'a@b.co', consent: true }), { params })
    expect(res.status).toBe(429)
    expect(h.subscriberUpsert).not.toHaveBeenCalled()
  })

  it('400s when consent is not given', async () => {
    seedTrainer()
    const res = await POST(req({ name: 'A', email: 'a@b.co', consent: false }), { params })
    expect(res.status).toBe(400)
    expect(h.subscriberUpsert).not.toHaveBeenCalled()
  })

  it('404s when the magnet is missing/inactive', async () => {
    h.trainerFindUnique.mockResolvedValue({ id: 't-1', businessName: 'P', logoUrl: null, emailAccentColor: null, user: { name: 'S', email: 'e' }, leadMagnets: [] })
    const res = await POST(req({ name: 'A', email: 'a@b.co', consent: true }), { params })
    expect(res.status).toBe(404)
  })

  it('404s when the trainer no longer has the add-on', async () => {
    seedTrainer()
    h.hasAddon.mockResolvedValue(false)
    const res = await POST(req({ name: 'A', email: 'a@b.co', consent: true }), { params })
    expect(res.status).toBe(404)
    expect(h.subscriberUpsert).not.toHaveBeenCalled()
  })

  it('captures the subscriber (consent snapshot) and emails the download', async () => {
    seedTrainer()
    const res = await POST(req({ name: 'Ada', email: 'Ada@Example.CO', consent: true }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)

    const upsertArg = h.subscriberUpsert.mock.calls[0][0]
    expect(upsertArg.where).toEqual({ trainerId_email: { trainerId: 't-1', email: 'ada@example.co' } }) // normalised
    expect(upsertArg.create.status).toBe('SUBSCRIBED')
    expect(upsertArg.create.consentAt).toBeInstanceOf(Date)
    expect(upsertArg.create.consentText).toBe('I agree.')
    expect(upsertArg.create.sourceLeadMagnetId).toBe('lm-1')

    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.sendEmail.mock.calls[0][0].to).toBe('ada@example.co')
  })

  it('still captures the lead if the email send throws', async () => {
    seedTrainer()
    h.sendEmail.mockRejectedValue(new Error('resend down'))
    const res = await POST(req({ name: 'A', email: 'a@b.co', consent: true }), { params })
    expect(res.status).toBe(200)
    expect(h.subscriberUpsert).toHaveBeenCalled()
  })
})
