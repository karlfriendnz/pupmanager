import { describe, it, expect, vi } from 'vitest'

// renderOnboardingEmail is pure, but its module imports prisma at the top —
// mock it so importing doesn't open a DB connection.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { renderOnboardingEmail } from '@/lib/onboarding/send-emails'

const tmpl = {
  subject: 'Welcome {{firstName}}',
  body: 'Hi {{firstName}}, great to have you.',
  topText: null,
  imageUrl: null,
  imageHeight: null,
  bottomText: null,
  senderKey: 'karl',
}
const ctx = { firstName: 'Sam' }

describe('onboarding email reply-to', () => {
  it('replies go to the shared support inbox', () => {
    expect(renderOnboardingEmail(tmpl, ctx).replyTo).toBe('brooke@pupmanager.com')
  })

  it('reply-to is the support inbox regardless of which founder voice sent it', () => {
    expect(renderOnboardingEmail({ ...tmpl, senderKey: 'brooke' }, ctx).replyTo).toBe('brooke@pupmanager.com')
    expect(renderOnboardingEmail({ ...tmpl, senderKey: 'someone-else' }, ctx).replyTo).toBe('brooke@pupmanager.com')
  })

  it('no personal gmail leaks into the reply-to', () => {
    expect(renderOnboardingEmail(tmpl, ctx).replyTo).not.toContain('gmail.com')
  })
})
