import { describe, it, expect, vi, beforeEach } from 'vitest'

// The trainer-profile PATCH route now carries a SINGLE brand colour
// (emailAccentColor) — the old appGradientStart / appGradientEnd fields are
// gone. These tests pin that: the brand colour is still accepted (and empty
// string clears it to null), and any leftover gradient fields in a request body
// are ignored rather than written to the DB.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  profileUpdate: vi.fn(),
  profileFindUnique: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { update: h.profileUpdate, findUnique: h.profileFindUnique },
  },
}))

import { PATCH, GET } from '@/app/api/trainer/profile/route'
import { isRichTextEmpty } from '@/lib/rich-text'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/trainer/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue({ companyId: 'company-1' })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1', trainerId: 'company-1' } })
  h.profileUpdate.mockResolvedValue({ id: 'company-1' })
})

describe('PATCH trainer/profile — brand colour', () => {
  it('accepts a hex brand colour and writes it to the owned profile', async () => {
    const res = await PATCH(req({ emailAccentColor: '#2a9da9' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { emailAccentColor: '#2a9da9' },
    })
  })

  it('clears the brand colour to null when passed an empty string', async () => {
    const res = await PATCH(req({ emailAccentColor: '' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { emailAccentColor: null },
    })
  })

  it('rejects a non-hex brand colour with 400 (no write)', async () => {
    const res = await PATCH(req({ emailAccentColor: 'teal' }))
    expect(res.status).toBe(400)
    expect(h.profileUpdate).not.toHaveBeenCalled()
  })

  it('accepts a square brand iconUrl alongside the logo', async () => {
    const res = await PATCH(req({ iconUrl: 'https://blob.example.com/icon.png' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { iconUrl: 'https://blob.example.com/icon.png' },
    })
  })

  it('clears the icon when passed an empty string', async () => {
    const res = await PATCH(req({ iconUrl: '' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { iconUrl: '' },
    })
  })

  it('ignores the retired appGradientStart / appGradientEnd fields', async () => {
    const res = await PATCH(req({
      emailAccentColor: '#123456',
      appGradientStart: '#000000',
      appGradientEnd: '#ffffff',
    }))
    expect(res.status).toBe(200)
    const data = h.profileUpdate.mock.calls[0][0].data
    expect(data).toEqual({ emailAccentColor: '#123456' })
    expect(data).not.toHaveProperty('appGradientStart')
    expect(data).not.toHaveProperty('appGradientEnd')
  })
})

// The client welcome note is now editable from Settings → Design with the
// shared rich-text editor, so the column holds Tiptap HTML that a trainer
// authors and every one of their clients reads. This route is the XSS boundary
// (rule 3: validation in the browser is not validation) and the only write path.
describe('PATCH trainer/profile — client welcome note', () => {
  it('stores the note as sanitized rich-text HTML', async () => {
    const res = await PATCH(req({ clientWelcomeNote: '<p>Welcome to <strong>Paws</strong>!</p>' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { clientWelcomeNote: '<p>Welcome to <strong>Paws</strong>!</p>' },
    })
  })

  it('strips a script tag (and an onerror handler) before it reaches the DB', async () => {
    const res = await PATCH(req({
      clientWelcomeNote: '<p>Hi</p><script>alert(document.cookie)</script><img src=x onerror="alert(1)">',
    }))
    expect(res.status).toBe(200)
    const stored = h.profileUpdate.mock.calls[0][0].data.clientWelcomeNote as string
    expect(stored).toContain('<p>Hi</p>')
    expect(stored).not.toContain('script')
    expect(stored).not.toContain('onerror')
    expect(stored).not.toContain('alert')
  })

  it('rewrites a javascript: link to something harmless', async () => {
    await PATCH(req({ clientWelcomeNote: '<p><a href="javascript:alert(1)">tap me</a></p>' }))
    const stored = h.profileUpdate.mock.calls[0][0].data.clientWelcomeNote as string
    expect(stored).not.toContain('javascript:')
    expect(stored).toContain('tap me')
  })

  it('keeps a legacy plain-text note readable — line breaks become markup', async () => {
    await PATCH(req({ clientWelcomeNote: 'Hi there\nSee you Saturday' }))
    const stored = h.profileUpdate.mock.calls[0][0].data.clientWelcomeNote as string
    expect(stored).toBe('<p>Hi there<br />See you Saturday</p>')
  })

  it('clears the note to null for an empty string (no empty Welcome card)', async () => {
    const res = await PATCH(req({ clientWelcomeNote: '' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { clientWelcomeNote: null },
    })
  })

  it('clears the note to null for the editor\'s empty document', async () => {
    await PATCH(req({ clientWelcomeNote: '<p></p>' }))
    expect(h.profileUpdate.mock.calls[0][0].data).toEqual({ clientWelcomeNote: null })
  })

  it('leaves the note alone when the patch does not mention it', async () => {
    await PATCH(req({ emailAccentColor: '#2a9da9' }))
    expect(h.profileUpdate.mock.calls[0][0].data).not.toHaveProperty('clientWelcomeNote')
  })

  it('rejects a note past the length cap with 400 (no write)', async () => {
    const res = await PATCH(req({ clientWelcomeNote: `<p>${'x'.repeat(4100)}</p>` }))
    expect(res.status).toBe(400)
    expect(h.profileUpdate).not.toHaveBeenCalled()
  })

  // Rule 1: a field the trainer typed must survive a reload. The Settings form
  // renders from the same read the GET does, so what was saved is what comes back.
  it('round-trips: what PATCH stored is what the next read returns', async () => {
    const typed = '<p>Welcome! <em>Bring treats.</em></p>'
    await PATCH(req({ clientWelcomeNote: typed }))
    const stored = h.profileUpdate.mock.calls[0][0].data.clientWelcomeNote as string
    h.profileFindUnique.mockResolvedValue({ id: 'company-1', clientWelcomeNote: stored })

    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).clientWelcomeNote).toBe(typed)
  })

  // The client home renders the Welcome block behind isRichTextEmpty(), so a
  // cleared note drops the card instead of drawing an empty one.
  it('a cleared note reads as empty to the client home gate; a real one does not', async () => {
    await PATCH(req({ clientWelcomeNote: '<p><br></p>' }))
    const cleared = h.profileUpdate.mock.calls[0][0].data.clientWelcomeNote as string | null
    expect(isRichTextEmpty(cleared)).toBe(true)
    expect(isRichTextEmpty('<p>Welcome to Paws</p>')).toBe(false)
  })

  // The client home is a server component: without this the note saved and the
  // already-cached home kept rendering the old greeting (the dog-photo bug).
  it('revalidates the client home so the saved note actually shows', async () => {
    await PATCH(req({ clientWelcomeNote: '<p>Hello</p>' }))
    expect(h.revalidatePath).toHaveBeenCalledWith('/home')
  })
})

describe('PATCH trainer/profile — base currency', () => {
  it('writes a supported base currency (always editable, incl. once Stripe is live)', async () => {
    const res = await PATCH(req({ payoutCurrency: 'gbp' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { payoutCurrency: 'gbp' },
    })
  })

  it('rejects an unsupported currency code with 400 (no write)', async () => {
    const res = await PATCH(req({ payoutCurrency: 'jpy' }))
    expect(res.status).toBe(400)
    expect(h.profileUpdate).not.toHaveBeenCalled()
  })
})
