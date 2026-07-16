import { describe, it, expect, vi, beforeEach } from 'vitest'

// A 15:00 (3pm) NZ class is stored as 03:00 UTC. Server-rendered emails that
// format the instant WITHOUT a timeZone render the raw UTC "3am" — the bug this
// suite guards against. Every server-side render of a session/class instant must
// pass an explicit timeZone (the trainer's, fallback Pacific/Auckland).
const UTC_3AM = new Date('2026-07-16T03:00:00Z') // == 15:00 (3pm) Pacific/Auckland
const NZ = 'Pacific/Auckland'

// ── Pure formatters (utils + booking-automations) ────────────────────────────
// booking-automations imports prisma/email/enquiries at module load — stub them
// so importing the pure formatter doesn't open a DB connection or send mail.
const h = vi.hoisted(() => ({ sentEmails: [] as Array<{ to: string; html?: string; text?: string }> }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/push', () => ({ sendPush: vi.fn(async () => ({ sent: 0 })) }))
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (args: { to: string; html?: string; text?: string }) => { h.sentEmails.push(args) }),
  fromTrainer: (n: string) => n,
}))

import { formatTime, formatDateTime } from '@/lib/utils'
import { formatBookingTime } from '@/lib/booking-automations'

describe('timezone-aware formatters render NZ local time, not server UTC', () => {
  it('formatTime shows 3:00 pm in Pacific/Auckland (not 3:00 am UTC)', () => {
    const out = formatTime(UTC_3AM, NZ)
    expect(out).toContain('3:00')
    expect(out.toLowerCase()).toContain('pm')
    expect(out.toLowerCase()).not.toContain('am')
  })

  it('formatDateTime shows the 3pm class time in NZ', () => {
    const out = formatDateTime(UTC_3AM, NZ).toLowerCase()
    expect(out).toContain('3:00')
    expect(out).toContain('pm')
    expect(out).not.toContain('am')
  })

  it('formatBookingTime (booking confirmations) renders in the trainer tz', () => {
    const out = formatBookingTime(UTC_3AM, NZ).toLowerCase()
    expect(out).toContain('3:00')
    expect(out).toContain('pm')
    expect(out).not.toContain('am')
  })

  it('regression: the same instant reads 3am under UTC — why the tz matters', () => {
    // Proves the fix is load-bearing: on Vercel (UTC runtime) an un-zoned render
    // produces "3am" for the very instant that is "3pm" in NZ.
    const utc = formatTime(UTC_3AM, 'UTC').toLowerCase()
    expect(utc).toContain('3:00')
    expect(utc).toContain('am')
    expect(formatTime(UTC_3AM, NZ).toLowerCase()).toContain('pm')
  })
})

// ── Enquiry "Submitted" time email (notify-enquiry-trainer) ───────────────────
vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' } }))
vi.mock('@/lib/notification-prefs', () => ({ resolvePref: vi.fn(async () => ({ enabled: true, title: 't', body: 'b' })) }))
vi.mock('@/lib/notification-types', () => ({ renderTemplate: (s: string) => s }))

import { prisma } from '@/lib/prisma'
import { notifyEnquiryTrainer } from '@/lib/notify-enquiry-trainer'

describe('enquiry email renders the Submitted time in the trainer timezone', () => {
  beforeEach(() => {
    h.sentEmails.length = 0
    ;(prisma as unknown as { enquiry: { findUnique: ReturnType<typeof vi.fn> } }).enquiry = {
      findUnique: vi.fn(async () => ({
        id: 'enq1',
        name: 'Jess Carter',
        email: 'jess@example.com',
        phone: null,
        dogName: 'Bailey',
        dogBreed: null,
        message: null,
        createdAt: UTC_3AM,
        trainer: { businessName: 'Pawsome', user: { id: 'u1', email: 'trainer@example.com', timezone: NZ } },
        form: { title: 'Contact form' },
      })),
    }
  })

  it('shows 3:00 pm (NZ), never the UTC 3:00 am', async () => {
    await notifyEnquiryTrainer({ enquiryId: 'enq1' })
    expect(h.sentEmails.length).toBe(1)
    const html = (h.sentEmails[0].html ?? '').toLowerCase()
    expect(html).toContain('3:00')
    expect(html).toContain('pm')
    expect(html).not.toContain('3:00 am')
  })
})
