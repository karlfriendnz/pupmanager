import { describe, it, expect, vi, beforeEach } from 'vitest'

// What a trade-show visitor agreed to, and when — the record that has to stand
// up years later to a GDPR / CCPA / Australian-APP request. A boolean would not,
// which is why every assertion here is about the VERSION and the TIMESTAMP.

const h = vi.hoisted(() => ({
  createLead: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { demoLead: { create: h.createLead } },
}))
vi.mock('@/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => null),
  getClientIp: () => '203.0.113.7',
}))

import { POST } from '@/app/api/try/lead/route'
import { TRY_MARKETING, TRY_TERMS, consentText, isCurrentConsentVersion } from '@/lib/demo-consent'

function req(body: unknown): Request {
  return new Request('https://app.pupmanager.com/api/try/lead', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'TradeShowPhone/1.0' },
    body: JSON.stringify(body),
  })
}

const GOOD = {
  name: 'Jess Carter',
  companyName: 'Carter Canine',
  email: 'Jess@CarterCanine.co.nz',
  acceptTerms: true,
  termsVersion: TRY_TERMS.id,
  marketingOptIn: false,
  marketingVersion: TRY_MARKETING.id,
}

beforeEach(() => {
  h.createLead.mockReset()
  h.createLead.mockResolvedValue({ id: 'lead-1' })
})

describe('consent text catalog', () => {
  it('resolves a stored version id back to the exact words that were on screen', () => {
    expect(consentText(TRY_TERMS.id)?.text).toBe(TRY_TERMS.text)
    expect(consentText(TRY_MARKETING.id)?.text).toBe(TRY_MARKETING.text)
  })

  it('returns null rather than a default for a version we never published', () => {
    // A silent fallback would make an unresolvable record LOOK like proof.
    expect(consentText('try-terms-v0')).toBeNull()
  })

  it('keeps terms and marketing as two different questions', () => {
    expect(TRY_TERMS.required).toBe(true)
    expect(TRY_MARKETING.required).toBe(false)
    expect(TRY_TERMS.id).not.toBe(TRY_MARKETING.id)
    expect(isCurrentConsentVersion('terms', TRY_TERMS.id)).toBe(true)
    expect(isCurrentConsentVersion('terms', TRY_MARKETING.id)).toBe(false)
  })
})

describe('POST /api/try/lead — recording consent', () => {
  it('stores the version AND the timestamp for the terms, not a bare boolean', async () => {
    const before = Date.now()
    const res = await POST(req(GOOD))
    expect(res.status).toBe(200)

    const data = h.createLead.mock.calls[0][0].data
    expect(data.termsVersion).toBe(TRY_TERMS.id)
    expect(data.termsAcceptedAt).toBeInstanceOf(Date)
    expect(data.termsAcceptedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('records the marketing wording even when they DECLINE — "offered and refused" is the record', async () => {
    await POST(req({ ...GOOD, marketingOptIn: false }))
    const data = h.createLead.mock.calls[0][0].data
    expect(data.marketingOptIn).toBe(false)
    expect(data.marketingVersion).toBe(TRY_MARKETING.id)
    expect(data.marketingOptInAt).toBeNull()
  })

  it('stamps marketingOptInAt only on an actual opt-in', async () => {
    await POST(req({ ...GOOD, marketingOptIn: true }))
    const data = h.createLead.mock.calls[0][0].data
    expect(data.marketingOptIn).toBe(true)
    expect(data.marketingOptInAt).toBeInstanceOf(Date)
  })

  it('still lets someone try the product with marketing unticked', async () => {
    const res = await POST(req({ ...GOOD, marketingOptIn: false }))
    expect(res.status).toBe(200)
    expect(h.createLead).toHaveBeenCalled()
  })

  it('REFUSES a submission with the terms unticked — the route, not just the screen', async () => {
    // AGENTS.md #3: validation in the browser is not validation.
    const res = await POST(req({ ...GOOD, acceptTerms: false }))
    expect(res.status).toBe(400)
    expect(h.createLead).not.toHaveBeenCalled()
  })

  it('refuses a submission with the terms key missing entirely', async () => {
    const { acceptTerms, ...withoutTerms } = GOOD
    void acceptTerms
    const res = await POST(req(withoutTerms))
    expect(res.status).toBe(400)
    expect(h.createLead).not.toHaveBeenCalled()
  })

  it('refuses a stale or invented consent version rather than recording it', async () => {
    const res = await POST(req({ ...GOOD, termsVersion: 'try-terms-v0' }))
    expect(res.status).toBe(409)
    expect(h.createLead).not.toHaveBeenCalled()
  })

  it('refuses an address that is not an email', async () => {
    const res = await POST(req({ ...GOOD, email: 'not-an-email' }))
    expect(res.status).toBe(400)
    expect(h.createLead).not.toHaveBeenCalled()
  })

  it('normalises the email so the marketing list does not hold two of the same person', async () => {
    await POST(req(GOOD))
    expect(h.createLead.mock.calls[0][0].data.email).toBe('jess@cartercanine.co.nz')
  })

  it('never stores the raw IP — only a salted one-way hash', async () => {
    await POST(req(GOOD))
    const data = h.createLead.mock.calls[0][0].data
    expect(data.ipHash).toBeTruthy()
    expect(data.ipHash).not.toContain('203.0.113.7')
  })

  it('allow-lists the source rather than storing whatever the QR said', async () => {
    // The poster's URL is a thing a stranger can photograph and retype, and
    // this column ends up in a marketing export.
    await POST(req({ ...GOOD, source: 'evil' }))
    expect(h.createLead.mock.calls[0][0].data.source).toBe('link')
    h.createLead.mockClear()
    await POST(req({ ...GOOD, source: 'qr' }))
    expect(h.createLead.mock.calls[0][0].data.source).toBe('qr')
  })

  it('slugs the campaign tag instead of trusting it', async () => {
    await POST(req({ ...GOOD, campaign: '  Dogz Online <b>2026</b> ' }))
    expect(h.createLead.mock.calls[0][0].data.campaign).toBe('dogz-online-b-2026-b')
  })

  it('sets the lead cookie httpOnly so the next step cannot name somebody else', async () => {
    const res = await POST(req(GOOD))
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('pm-try-lead=lead-1')
    expect(cookie.toLowerCase()).toContain('httponly')
  })
})
