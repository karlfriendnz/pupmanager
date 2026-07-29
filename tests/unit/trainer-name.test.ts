import { describe, it, expect } from 'vitest'
import { clientFacingTrainerName } from '@/lib/trainer-name'
import { renderClientNotificationEmail } from '@/lib/client-notification-email'

// A trainer has two names. Clients deal with the BUSINESS; the owner's own name
// is their login identity, like the private email beside publicEmail. Most
// client-facing paths already got this right — a handful had the fallback the
// other way round, so a solo trainer's booking confirmation went out signed
// "Alison Brock via PupManager" for a business called Mersea Mutts.

describe('clientFacingTrainerName', () => {
  it('prefers the business name over the owner’s own name', () => {
    expect(clientFacingTrainerName({ businessName: 'Mersea Mutts', user: { name: 'Alison Brock' } }))
      .toBe('Mersea Mutts')
  })

  // OAuth and Apple signups land with an empty businessName until the
  // profile-completion gate is passed — better their name than "Your trainer".
  it('falls back to the owner’s name when there is no business name', () => {
    expect(clientFacingTrainerName({ businessName: '', user: { name: 'Alison Brock' } }))
      .toBe('Alison Brock')
    expect(clientFacingTrainerName({ businessName: null, user: { name: 'Alison Brock' } }))
      .toBe('Alison Brock')
  })

  it('ignores whitespace-only names', () => {
    expect(clientFacingTrainerName({ businessName: '   ', user: { name: 'Alison Brock' } }))
      .toBe('Alison Brock')
    expect(clientFacingTrainerName({ businessName: '  ', user: { name: '  ' } }))
      .toBe('Your trainer')
  })

  it('has a last resort, and lets the caller choose it', () => {
    expect(clientFacingTrainerName(null)).toBe('Your trainer')
    expect(clientFacingTrainerName(undefined)).toBe('Your trainer')
    expect(clientFacingTrainerName(null, '')).toBe('')
  })
})

describe('the client notification email signs itself with the business', () => {
  const rendered = renderClientNotificationEmail({
    trainer: {
      businessName: 'Mersea Mutts | Nosework Unleashed',
      logoUrl: null,
      emailAccentColor: null,
      user: { name: 'Alison Brock', email: 'merseamutts@example.com' },
    },
    title: 'You’re booked in',
    body: 'Your dog is booked into Mantrailing Progression.',
    detail: '4 sessions',
    description: null,
    sessions: [],
    ctaLabel: 'View your sessions',
    ctaHref: 'https://app.pupmanager.com/my-sessions',
  })

  // displayName is what fromTrainer() puts in the inbox's sender column.
  it('uses the business as the sender name', () => {
    expect(rendered.displayName).toBe('Mersea Mutts | Nosework Unleashed')
  })

  it('never puts the owner’s personal name in the sender', () => {
    expect(rendered.displayName).not.toContain('Alison Brock')
  })

  // Reply-To still reaches the person — that part was never the problem.
  it('still replies to the trainer', () => {
    expect(rendered.trainerEmail).toBe('merseamutts@example.com')
  })
})
