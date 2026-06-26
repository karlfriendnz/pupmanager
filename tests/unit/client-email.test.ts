import { describe, it, expect } from 'vitest'
import { buildClientEmail, fillPlaceholders } from '@/lib/client-email'

const trainer = { displayName: 'Jess Carter', businessName: 'Paws & Thrive', logoUrl: null, emailAccentColor: '#0d9488' }

describe('fillPlaceholders', () => {
  it('substitutes known tokens and leaves unknown ones visible', () => {
    const out = fillPlaceholders('Hi {{clientName}} & {{dogName}} — {{bogus}}', {
      clientName: 'Sam', dogName: 'Rex',
    })
    expect(out).toBe('Hi Sam & Rex — {{bogus}}')
  })
})

describe('buildClientEmail', () => {
  const base = {
    recipient: { name: 'Sam', dogName: 'Rex' },
    trainer,
    subject: 'Update for {{clientName}}',
    body: '<p>Hello {{clientName}}, how is {{dogName}}? — {{businessName}}</p>',
  }

  it('resolves placeholders in subject and body', () => {
    const out = buildClientEmail(base)
    expect(out.subject).toBe('Update for Sam')
    expect(out.html).toContain('Hello Sam, how is Rex?')
    expect(out.html).toContain('Paws &amp; Thrive') // business name escaped in shell
    expect(out.text).toContain('Hello Sam, how is Rex?')
  })

  it('falls back to "there" when the client has no name', () => {
    const out = buildClientEmail({ ...base, recipient: { name: null }, subject: 'Hi {{clientName}}' })
    expect(out.subject).toBe('Hi there')
  })

  it('omits the unsubscribe footer for transactional sends (no unsubscribeUrl)', () => {
    const out = buildClientEmail(base)
    expect(out.html).not.toContain('Unsubscribe')
    expect(out.text).not.toContain('Unsubscribe')
  })

  it('includes the reason + unsubscribe link for bulk sends', () => {
    const out = buildClientEmail({ ...base, unsubscribeUrl: 'https://app/unsubscribe/tok123' })
    expect(out.html).toContain('https://app/unsubscribe/tok123')
    expect(out.html).toContain('Unsubscribe')
    expect(out.html.toLowerCase()).toContain("you're receiving this because")
    expect(out.text).toContain('Unsubscribe: https://app/unsubscribe/tok123')
  })

  it('renders a header image when provided, omits it otherwise', () => {
    const withImg = buildClientEmail({ ...base, headerImageUrl: 'https://blob/img.jpg' })
    expect(withImg.html).toContain('src="https://blob/img.jpg"')
    const without = buildClientEmail(base)
    expect(without.html).not.toContain('<img')
  })

  it('strips dangerous markup from the authored body', () => {
    const out = buildClientEmail({ ...base, body: '<p>ok</p><script>alert(1)</script>' })
    expect(out.html).not.toContain('<script>')
  })
})
