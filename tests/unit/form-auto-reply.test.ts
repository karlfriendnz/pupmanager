import { describe, it, expect, vi } from 'vitest'

// Pure-logic test: stub infra so importing the module doesn't spin up Prisma.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(), fromTrainer: (n: string) => n }))

import { resolveAutoReply, isAutoReplyMode } from '@/lib/form-auto-reply'

const VARS = { business: 'Journey Dog Training', name: 'Sarah' }

const form = (over: Partial<Parameters<typeof resolveAutoReply>[0]> = {}) => ({
  autoReplyMode: 'OFF',
  autoReplySubject: null,
  autoReplyBody: null,
  autoReplyTemplate: null,
  ...over,
})

describe('resolveAutoReply', () => {
  it('OFF sends nothing', () => {
    expect(resolveAutoReply(form(), VARS)).toBeNull()
  })

  it('CUSTOM uses the copy written on the form, with placeholders filled', () => {
    const r = resolveAutoReply(
      form({
        autoReplyMode: 'CUSTOM',
        autoReplySubject: 'Thanks for contacting {business}',
        autoReplyBody: 'Hi {name}, we got your enquiry.',
      }),
      VARS,
    )
    expect(r?.subject).toBe('Thanks for contacting Journey Dog Training')
    expect(r?.html).toContain('Sarah')
    expect(r?.html).not.toContain('{name}')
  })

  it('TEMPLATE uses the saved template, with placeholders filled', () => {
    const r = resolveAutoReply(
      form({
        autoReplyMode: 'TEMPLATE',
        autoReplyTemplate: { subject: 'Welcome from {business}', body: 'Hello {name}!' },
      }),
      VARS,
    )
    expect(r?.subject).toBe('Welcome from Journey Dog Training')
    expect(r?.html).toContain('Hello Journey'.slice(0, 5)) // body rendered
    expect(r?.html).toContain('Sarah')
  })

  // The FK is onDelete: SetNull, so deleting a template leaves the form in
  // TEMPLATE mode pointing at nothing. Must fail closed, not send an empty mail.
  it('TEMPLATE with a deleted template sends nothing', () => {
    expect(resolveAutoReply(form({ autoReplyMode: 'TEMPLATE', autoReplyTemplate: null }), VARS)).toBeNull()
  })

  it('a half-configured CUSTOM form sends nothing', () => {
    expect(resolveAutoReply(form({ autoReplyMode: 'CUSTOM', autoReplySubject: 'Hi', autoReplyBody: null }), VARS)).toBeNull()
    expect(resolveAutoReply(form({ autoReplyMode: 'CUSTOM', autoReplySubject: null, autoReplyBody: 'Hi' }), VARS)).toBeNull()
    expect(resolveAutoReply(form({ autoReplyMode: 'CUSTOM', autoReplySubject: '   ', autoReplyBody: '  ' }), VARS)).toBeNull()
  })

  it('an unrecognised mode fails closed', () => {
    expect(resolveAutoReply(form({ autoReplyMode: 'SOMETHING_ELSE' }), VARS)).toBeNull()
  })

  // The subject is plain text and must not be HTML-escaped; the body is HTML
  // and must be. A business name with an ampersand exercises both.
  it("escapes the body but not the subject", () => {
    const r = resolveAutoReply(
      form({
        autoReplyMode: 'CUSTOM',
        autoReplySubject: 'From {business}',
        autoReplyBody: 'Sent by {business}',
      }),
      { business: 'Paws & Thrive', name: 'Sarah' },
    )
    expect(r?.subject).toBe('From Paws & Thrive')
    expect(r?.html).toContain('&amp;')
  })
})

describe('isAutoReplyMode', () => {
  it('accepts the three real modes and rejects anything else', () => {
    expect(isAutoReplyMode('OFF')).toBe(true)
    expect(isAutoReplyMode('TEMPLATE')).toBe(true)
    expect(isAutoReplyMode('CUSTOM')).toBe(true)
    expect(isAutoReplyMode('off')).toBe(false)
    expect(isAutoReplyMode('')).toBe(false)
  })
})
