import { describe, it, expect, vi } from 'vitest'

// Placeholders are LABELLED in plain language but STORED as tokens. Trainers'
// saved comms-flow steps, email templates and drafts hold `{{name}}` /
// `{{clientName}}` verbatim in the database, so this file's job is to pin the
// tokens against accidental renaming and prove every labelled token is one the
// send-time substitution actually knows how to fill.

const h = vi.hoisted(() => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/push', () => ({ sendPush: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), fromTrainer: (n: string) => n }))
vi.mock('@/lib/client-notification-email', () => ({ renderClientNotificationEmail: vi.fn() }))
void h

import {
  COMMS_PLACEHOLDER_OPTIONS,
  MEMBERSHIP_PLACEHOLDER_OPTIONS,
  CLIENT_EMAIL_PLACEHOLDER_OPTIONS,
  placeholderLabel,
} from '@/lib/placeholder-labels'
import { COMMS_PLACEHOLDERS, MEMBERSHIP_PLACEHOLDERS, renderCommsMessage, type CommsVars } from '@/lib/comms-flows'
import { buildClientEmail, fillPlaceholders } from '@/lib/client-email'

const ALL = [
  ...COMMS_PLACEHOLDER_OPTIONS,
  ...MEMBERSHIP_PLACEHOLDER_OPTIONS,
  ...CLIENT_EMAIL_PLACEHOLDER_OPTIONS,
]

describe('placeholder tokens are unchanged', () => {
  // Hard-coded, not derived: this is the regression lock. Changing a token here
  // means every message a trainer has already saved stops substituting.
  it('the comms-flow vocabulary is exactly the tokens the engine substitutes', () => {
    expect(COMMS_PLACEHOLDER_OPTIONS.map(o => o.token)).toEqual([
      '{{name}}', '{{dog}}', '{{time}}', '{{date}}', '{{class}}', '{{business}}', '{{location}}',
    ])
    expect(COMMS_PLACEHOLDER_OPTIONS.map(o => o.token)).toEqual([...COMMS_PLACEHOLDERS])
  })

  it('the membership vocabulary is exactly the tokens the engine substitutes', () => {
    expect(MEMBERSHIP_PLACEHOLDER_OPTIONS.map(o => o.token)).toEqual([
      '{{name}}', '{{dog}}', '{{membership}}', '{{business}}', '{{date}}',
    ])
    expect(new Set(MEMBERSHIP_PLACEHOLDER_OPTIONS.map(o => o.token)))
      .toEqual(new Set(MEMBERSHIP_PLACEHOLDERS))
  })

  it('the client-email vocabulary is exactly the tokens buildClientEmail fills', () => {
    expect(CLIENT_EMAIL_PLACEHOLDER_OPTIONS.map(o => o.token)).toEqual([
      '{{clientName}}', '{{trainerName}}', '{{businessName}}', '{{dogName}}',
    ])
  })

  it('every token is still `{{...}}` — the labels are display only', () => {
    for (const { token } of ALL) expect(token).toMatch(/^\{\{[a-zA-Z]+\}\}$/)
  })
})

describe('labels read as words, not code', () => {
  it('no label leaks braces or a raw token', () => {
    for (const { label } of ALL) {
      expect(label).not.toContain('{')
      expect(label).not.toContain('}')
      expect(label).toMatch(/^[A-Z][a-z]+( [a-z]+)*$/) // "Client name", "Dog name"
    }
  })

  it('the same concept reads the same everywhere', () => {
    expect(placeholderLabel('{{name}}')).toBe('Client name')
    expect(placeholderLabel('{{clientName}}')).toBe('Client name')
    expect(placeholderLabel('{{dog}}')).toBe('Dog name')
    expect(placeholderLabel('{{dogName}}')).toBe('Dog name')
    expect(placeholderLabel('{{business}}')).toBe('Business name')
    expect(placeholderLabel('{{businessName}}')).toBe('Business name')
  })

  it('falls back to the raw token for anything unknown', () => {
    expect(placeholderLabel('{{nope}}')).toBe('{{nope}}')
  })
})

describe('every labelled token still substitutes at send time', () => {
  const vars: CommsVars = {
    name: 'Sam', dog: 'Bailey', time: '6:00 pm', date: 'Tue 5 Aug',
    class: 'Puppy Class', business: 'Waggy Tails', location: 'The Hall',
    membership: 'Gold Club',
  }

  it('renderCommsMessage fills each comms/membership token', () => {
    for (const { token } of [...COMMS_PLACEHOLDER_OPTIONS, ...MEMBERSHIP_PLACEHOLDER_OPTIONS]) {
      const out = renderCommsMessage({ title: token, body: `x ${token} y` }, vars)
      expect(out.title, `${token} left unfilled in the title`).not.toContain('{{')
      expect(out.body, `${token} left unfilled in the body`).not.toContain('{{')
    }
  })

  it('a whole message built from labelled tokens renders with no leftovers', () => {
    const body = COMMS_PLACEHOLDER_OPTIONS.map(o => o.token).join(' ')
    expect(renderCommsMessage({ title: 'Hi', body }, vars).body)
      .toBe('Sam Bailey 6:00 pm Tue 5 Aug Puppy Class Waggy Tails The Hall')
  })

  it('buildClientEmail fills each client-email token', () => {
    const body = `<p>${CLIENT_EMAIL_PLACEHOLDER_OPTIONS.map(o => o.token).join(' ')}</p>`
    const out = buildClientEmail({
      recipient: { name: 'Sam', dogName: 'Rex' },
      trainer: { displayName: 'Jess Carter', businessName: 'Paws', logoUrl: null, emailAccentColor: null },
      subject: '{{clientName}}',
      body,
    })
    expect(out.subject).toBe('Sam')
    expect(out.html).toContain('Sam Jess Carter Paws Rex')
    expect(out.text).toContain('Sam Jess Carter Paws Rex')
  })

  it('an unknown token is left visible rather than silently blanked', () => {
    expect(fillPlaceholders('{{clientName}} {{bogus}}', { clientName: 'Sam' })).toBe('Sam {{bogus}}')
  })
})

describe('the "Hit reply" footer line is gone', () => {
  const built = buildClientEmail({
    recipient: { name: 'Sam', dogName: 'Rex' },
    trainer: { displayName: 'Jess Carter', businessName: 'Paws', logoUrl: null, emailAccentColor: null },
    subject: 'Hi',
    body: '<p>Body</p>',
    unsubscribeUrl: 'https://app/unsubscribe/tok',
  })

  it('is absent from the HTML part', () => {
    expect(built.html).not.toContain('Hit reply')
  })

  it('is absent from the plain-text part', () => {
    expect(built.text).not.toContain('Hit reply')
  })

  it('the rest of the footer survives', () => {
    expect(built.html).toContain('Jess Carter')
    expect(built.html).toContain('Unsubscribe')
  })
})
