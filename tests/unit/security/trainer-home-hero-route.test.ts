import { describe, it, expect, vi, beforeEach } from 'vitest'

// The trainer home's background photo, and whether the logo shows over it.
//
// Two properties are load-bearing here and each fails in a way that would not
// be obvious from the screen:
//
//   1. IT IS THE COMPANY'S SETTING, NOT THE CALLER'S. It was asked for as "the
//      same design for all the trainers in that company", so the write has to
//      land on the caller's OWN company row and nowhere else. A trainerId or a
//      companyId in the request body must be ignored — otherwise a member of
//      one business could repaint another business's home screen, and the only
//      person who'd notice is the trainer who didn't change anything.
//
//   2. THE URL IS VALIDATED, NOT TRUSTED. This value is rendered inside a CSS
//      `url()`, not an <img src>, so a string carrying a quote or a paren can
//      close the declaration and open a new one. The browser is the only thing
//      that knows an upload happened, which means the server has to treat the
//      URL as arbitrary text from a client. Escaping at render time is a second
//      line — the first is refusing to store it.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  profileUpdate: vi.fn(),
  profileFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { update: h.profileUpdate, findUnique: h.profileFindUnique },
  },
}))

import { NextResponse } from 'next/server'
import { PATCH } from '@/app/api/trainer/profile/route'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/trainer/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

const BLOB = 'https://abc123.public.blob.vercel-storage.com/trainer-branding/company-1/background/9f2.jpg'

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue({ companyId: 'company-1' })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1', trainerId: 'company-1' } })
  h.profileUpdate.mockResolvedValue({ id: 'company-1' })
})

describe('PATCH trainer/profile — home hero ownership', () => {
  it('writes the photo to the CALLER’S OWN company row', async () => {
    const res = await PATCH(req({ homeHeroImageUrl: BLOB }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { homeHeroImageUrl: BLOB },
    })
  })

  it('ignores a companyId / trainerId / id smuggled in the body', async () => {
    // The permission guard decides the tenant; the body never does. If any of
    // these ever reached `where`, one business could repaint another's home.
    const res = await PATCH(req({
      homeHeroImageUrl: BLOB,
      companyId: 'company-2',
      trainerId: 'company-2',
      id: 'company-2',
    }))
    expect(res.status).toBe(200)
    const call = h.profileUpdate.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'company-1' })
    expect(call.data).toEqual({ homeHeroImageUrl: BLOB })
    expect(call.data).not.toHaveProperty('companyId')
    expect(call.data).not.toHaveProperty('trainerId')
    expect(call.data).not.toHaveProperty('id')
  })

  it('refuses a caller with no settings.edit permission before touching the DB', async () => {
    // guardPermission short-circuits with its own Response when the member
    // can't edit settings — the route must return it and write nothing.
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await PATCH(req({ homeHeroImageUrl: BLOB }))
    expect(res.status).toBe(403)
    expect(h.profileUpdate).not.toHaveBeenCalled()
  })

  it('stores the lockup choice as a boolean on the same company row', async () => {
    const res = await PATCH(req({ homeHeroShowLockup: false }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { homeHeroShowLockup: false },
    })
  })

  it('rejects a non-boolean lockup choice with 400 (no write)', async () => {
    const res = await PATCH(req({ homeHeroShowLockup: 'yes' }))
    expect(res.status).toBe(400)
    expect(h.profileUpdate).not.toHaveBeenCalled()
  })
})

describe('PATCH trainer/profile — home hero URL is validated, not trusted', () => {
  it('clears the photo to null when passed an empty string', async () => {
    const res = await PATCH(req({ homeHeroImageUrl: '' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { homeHeroImageUrl: null },
    })
  })

  it.each([
    // Would break out of url("…") and let the rest of the string be read as CSS.
    ['a double quote', 'https://evil.example.com/a".jpg'],
    ['a single quote', "https://evil.example.com/a'.jpg"],
    ['a closing paren', 'https://evil.example.com/a).jpg'],
    ['a backslash', 'https://evil.example.com/a\\.jpg'],
    ['angle brackets', 'https://evil.example.com/<script>.jpg'],
    ['a newline', 'https://evil.example.com/a.jpg\n;background:red'],
    // Not an https image at all.
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
    ['plain http', 'http://insecure.example.com/a.jpg'],
    ['a bare app path', '/uploads/a.jpg'],
    ['free text', 'my photo'],
  ])('rejects %s with 400 and writes nothing', async (_label, url) => {
    const res = await PATCH(req({ homeHeroImageUrl: url }))
    expect(res.status).toBe(400)
    expect(h.profileUpdate).not.toHaveBeenCalled()
  })

  it('accepts a real Blob URL with a query string and percent-encoding', async () => {
    const url = `${BLOB}?v=2&name=my%20photo`
    const res = await PATCH(req({ homeHeroImageUrl: url }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { homeHeroImageUrl: url },
    })
  })
})
