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
  LEGACY_PLACEHOLDER_OPTIONS,
  CLIENT_EMAIL_PLACEHOLDER_OPTIONS,
  CLIENT_INVITE_PLACEHOLDER_OPTIONS,
  BOOKING_PAGE_PLACEHOLDER_OPTIONS,
  commsPlaceholderOptionsFor,
  NOTIFICATION_PLACEHOLDER_LABELS,
  notificationPlaceholderLabel,
  placeholderLabel,
} from '@/lib/placeholder-labels'
import {
  COMMS_PLACEHOLDERS, MEMBERSHIP_PLACEHOLDERS, LEGACY_MEMBERSHIP_TOKEN,
  MEMBERSHIP_STARTER_STEPS, renderCommsMessage, type CommsVars,
} from '@/lib/comms-flows'
import { buildClientEmail, fillPlaceholders } from '@/lib/client-email'
import { AUTOMATION_PLACEHOLDERS, renderAutomationEmail } from '@/lib/booking-automations'
import { renderClientInviteEmail } from '@/lib/client-invite-email'
import { NOTIFICATION_TYPES, renderTemplate } from '@/lib/notification-types'

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
      '{{name}}', '{{dog}}', '{{package}}', '{{business}}', '{{date}}',
    ])
    expect(new Set(MEMBERSHIP_PLACEHOLDER_OPTIONS.map(o => o.token)))
      .toEqual(new Set(MEMBERSHIP_PLACEHOLDERS))
  })

  // The bug this locks: the comms-flow editor hard-coded the class vocabulary,
  // so a MEMBERSHIP flow offered "Session time / Session date / Class name /
  // Location" — none of which say anything about a membership — and never
  // offered {{membership}}, which processMembershipStep does fill. Offering a
  // token that renders literally is the fault, so the set has to be chosen by
  // what the flow hangs off.
  it('a membership flow is offered the membership vocabulary, not the class one', () => {
    expect(commsPlaceholderOptionsFor('membership')).toBe(MEMBERSHIP_PLACEHOLDER_OPTIONS)
    expect(commsPlaceholderOptionsFor('session')).toBe(COMMS_PLACEHOLDER_OPTIONS)

    const membershipTokens = commsPlaceholderOptionsFor('membership').map(o => o.token)
    expect(membershipTokens).toContain('{{package}}')
    // The four that had nothing to substitute against a purchase.
    for (const dead of ['{{time}}', '{{class}}', '{{location}}']) {
      expect(membershipTokens).not.toContain(dead)
    }
    // …and the class flow must not start advertising the package token, which
    // its own engine leaves as an empty string.
    const sessionTokens = commsPlaceholderOptionsFor('session').map(o => o.token)
    expect(sessionTokens).not.toContain('{{package}}')
    expect(sessionTokens).not.toContain('{{membership}}')
  })

  // The one rename in the whole file, done the only way a rename is safe: the
  // old spelling is still SUBSTITUTED, it just isn't OFFERED any more. Saved
  // steps hold `{{membership}}` verbatim, so dropping it from `fill` would
  // print a raw token to a client. Migration 20260727200000 rewrites the stored
  // rows; the alias is what makes that a tidy-up rather than a cutover.
  it('the retired {{membership}} spelling is accepted but never offered', () => {
    expect(LEGACY_MEMBERSHIP_TOKEN).toBe('{{membership}}')
    expect(LEGACY_PLACEHOLDER_OPTIONS.map(o => o.token)).toContain(LEGACY_MEMBERSHIP_TOKEN)

    // Not offered anywhere a trainer picks a token…
    for (const context of ['session', 'membership'] as const) {
      expect(commsPlaceholderOptionsFor(context).map(o => o.token))
        .not.toContain(LEGACY_MEMBERSHIP_TOKEN)
    }
    // …but it still reads as the same thing, and still fills.
    expect(placeholderLabel(LEGACY_MEMBERSHIP_TOKEN)).toBe('Package name')
    expect(placeholderLabel('{{package}}')).toBe('Package name')
  })

  it('the client-email vocabulary is exactly the tokens buildClientEmail fills', () => {
    expect(CLIENT_EMAIL_PLACEHOLDER_OPTIONS.map(o => o.token)).toEqual([
      '{{clientName}}', '{{trainerName}}', '{{businessName}}', '{{dogName}}',
    ])
  })

  it('the invite vocabulary is only what renderClientInviteEmail substitutes', () => {
    expect(CLIENT_INVITE_PLACEHOLDER_OPTIONS.map(o => o.token)).toEqual([
      '{{clientName}}', '{{dogName}}',
    ])
  })

  it('every token is still `{{...}}` — the labels are display only', () => {
    for (const { token } of ALL) expect(token).toMatch(/^\{\{[a-zA-Z]+\}\}$/)
  })

  // Booking-page automations are a SEPARATE engine: `fill()` in
  // booking-automations.ts matches /\{name\}/g, so its tokens carry ONE brace
  // and neither engine can read the other's. Labelling them must not "tidy"
  // them into the {{…}} house style.
  it('the booking-page vocabulary is single-brace and matches its own engine', () => {
    expect(BOOKING_PAGE_PLACEHOLDER_OPTIONS.map(o => o.token)).toEqual([
      '{name}', '{dog}', '{time}', '{business}',
    ])
    expect(BOOKING_PAGE_PLACEHOLDER_OPTIONS.map(o => o.token)).toEqual([...AUTOMATION_PLACEHOLDERS])
    for (const { token } of BOOKING_PAGE_PLACEHOLDER_OPTIONS) {
      expect(token).toMatch(/^\{[a-zA-Z]+\}$/)
      expect(token).not.toContain('{{')
    }
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

  // The step rows already in the database contain `{{membership}}`. If the
  // rename to `{{package}}` had shipped without this, every one of them would
  // have sent a client the literal text "{{membership}}".
  it('fills BOTH spellings of the package token to the same value', () => {
    expect(renderCommsMessage({ title: '{{package}}', body: '{{membership}}' }, vars))
      .toMatchObject({ title: 'Gold Club', body: 'Gold Club' })
    // Whitespace inside the braces is tolerated on both, which is why the
    // migration's exact-string REPLACE can safely miss those rows.
    expect(renderCommsMessage({ title: 'x', body: '{{ membership }} / {{ package }}' }, vars).body)
      .toBe('Gold Club / Gold Club')
    // A step written in either spelling, mixed, still renders whole.
    expect(renderCommsMessage({ title: 'x', body: 'Welcome to {{membership}}, {{name}} — enjoy {{package}}!' }, vars).body)
      .toBe('Welcome to Gold Club, Sam — enjoy Gold Club!')
  })

  // Nothing NEW may be written in the old spelling, or the backfill just has to
  // run again.
  it('the membership starter flow inserts the new spelling', () => {
    const written = MEMBERSHIP_STARTER_STEPS.map(s => `${s.title} ${s.body}`).join(' ')
    expect(written).not.toContain(LEGACY_MEMBERSHIP_TOKEN)
    expect(written).toContain('{{package}}')
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

  it('renderAutomationEmail fills each booking-page token', () => {
    const body = BOOKING_PAGE_PLACEHOLDER_OPTIONS.map(o => o.token).join(' ')
    const out = renderAutomationEmail(
      { subject: body, body },
      { name: 'Sam', dog: 'Bailey', time: 'Tue 5 Aug, 6:00 pm', business: 'Waggy Tails' },
    )
    expect(out.subject).toBe('Sam Bailey Tue 5 Aug, 6:00 pm Waggy Tails')
    expect(out.html).toContain('Sam Bailey Tue 5 Aug, 6:00 pm Waggy Tails')
  })

  it('renderClientInviteEmail fills each invite token — and only those', () => {
    const rendered = renderClientInviteEmail({
      clientName: 'Sam',
      dogNames: ['Bailey'],
      trainer: {
        businessName: 'Paws',
        logoUrl: null,
        emailAccentColor: null,
        user: { name: 'Jess Carter', email: 'jess@paws.test' },
      },
      bodyTemplate: CLIENT_INVITE_PLACEHOLDER_OPTIONS.map(o => o.token).join(' '),
      inviteUrl: 'https://app/invite?token=t',
    })
    expect(rendered.text).toContain('Sam Bailey')
    // The tokens the invite renderer does NOT know stay literal — which is why
    // the invite editor must not offer them.
    const notOffered = CLIENT_EMAIL_PLACEHOLDER_OPTIONS
      .filter(o => !CLIENT_INVITE_PLACEHOLDER_OPTIONS.some(i => i.token === o.token))
      .map(o => o.token)
    expect(notOffered).toEqual(['{{trainerName}}', '{{businessName}}'])
    const leftover = renderClientInviteEmail({
      clientName: 'Sam',
      dogNames: ['Bailey'],
      trainer: {
        businessName: 'Paws',
        logoUrl: null,
        emailAccentColor: null,
        user: { name: 'Jess Carter', email: 'jess@paws.test' },
      },
      bodyTemplate: notOffered.join(' '),
      inviteUrl: 'https://app/invite?token=t',
    })
    expect(leftover.text).toContain('{{trainerName}} {{businessName}}')
  })
})

// Settings → Notifications is a FOURTH vocabulary: notification-types.ts stores
// placeholder names bare (`dogName`) per type and the panel wraps them in
// braces. Same rule — the stored names never move, only the labels are new.
describe('notification placeholder labels', () => {
  const declared = [...new Set(Object.values(NOTIFICATION_TYPES).flatMap(m => m.placeholders))].sort()

  it('every name a notification type declares has a plain-language label', () => {
    for (const name of declared) {
      expect(NOTIFICATION_PLACEHOLDER_LABELS[name], `${name} has no label`).toBeTruthy()
    }
  })

  it('carries no labels for names no notification type offers', () => {
    expect(Object.keys(NOTIFICATION_PLACEHOLDER_LABELS).sort()).toEqual(declared)
  })

  it('no label leaks a brace or reads as code', () => {
    for (const [name, label] of Object.entries(NOTIFICATION_PLACEHOLDER_LABELS)) {
      expect(label, name).not.toContain('{')
      expect(label, name).not.toBe(name)
      expect(label, name).toMatch(/^[A-Z]/)
    }
  })

  it('falls back to the raw name for anything unknown', () => {
    expect(notificationPlaceholderLabel('nope')).toBe('nope')
  })

  it('every offered name is one the sender actually substitutes', () => {
    // sampleValues is the per-type map the "Send test" button renders with, and
    // the crons build the same shape — a name missing from it would render as a
    // literal {{token}} in a real notification.
    for (const meta of Object.values(NOTIFICATION_TYPES)) {
      for (const name of meta.placeholders) {
        expect(meta.sampleValues[name], `${meta.type}.${name} has no value to substitute`).toBeDefined()
      }
      const body = meta.placeholders.map(p => `{{${p}}}`).join(' ')
      expect(renderTemplate(body, meta.sampleValues), meta.type).not.toContain('{{')
    }
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
