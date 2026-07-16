import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// ── Pure helpers ────────────────────────────────────────────────────────────
import {
  buildLinkButtons,
  buildSocialLinks,
  socialUrl,
  safeExternalUrl,
  isHttpUrl,
  isLinkPageFontId,
  isLinkButtonType,
  linkPageFontStack,
  LINK_PAGE_FONTS,
  LINK_BUTTON_TYPES,
  type LinkButtonRow,
} from '@/lib/link-page'
import { addonById, isFreeAddon, isSellableAddon, isAddonId } from '@/lib/pricing'

const TRAINER = {
  slug: 'jess',
  website: 'jessdogs.com',
  publicEmail: 'hi@jessdogs.com',
  phone: '021 555 0000',
  showPhoneToClients: true,
}

// Small helper to build a config from just the ordered rows.
function cfg(links: LinkButtonRow[]) {
  return { headline: null, bio: null, instagram: null, facebook: null, tiktok: null, links }
}

describe('link-page helpers', () => {
  it('safeExternalUrl assumes https for a bare domain and rejects non-http(s)', () => {
    expect(safeExternalUrl('example.com')).toBe('https://example.com/')
    expect(safeExternalUrl('http://foo.com')).toBe('http://foo.com/')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('mailto:a@b.com')).toBeNull()
    expect(safeExternalUrl('')).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
  })

  it('isHttpUrl only accepts absolute http(s)', () => {
    expect(isHttpUrl('https://a.com')).toBe(true)
    expect(isHttpUrl('ftp://a.com')).toBe(false)
    expect(isHttpUrl('not a url')).toBe(false)
  })

  it('isLinkButtonType recognises the enum members only', () => {
    for (const t of LINK_BUTTON_TYPES) expect(isLinkButtonType(t)).toBe(true)
    expect(isLinkButtonType('NOPE')).toBe(false)
    expect(isLinkButtonType(null)).toBe(false)
  })

  it('socialUrl normalises handles and passes through full URLs', () => {
    expect(socialUrl('instagram', '@jess')).toBe('https://instagram.com/jess')
    expect(socialUrl('facebook', 'jessdogs')).toBe('https://facebook.com/jessdogs')
    expect(socialUrl('tiktok', '@jess')).toBe('https://tiktok.com/@jess')
    expect(socialUrl('instagram', 'https://instagram.com/jess')).toBe('https://instagram.com/jess')
    expect(socialUrl('instagram', '')).toBeNull()
    expect(socialUrl('instagram', null)).toBeNull()
  })

  it('buildLinkButtons resolves each type to the right href + icon + external flag', () => {
    const buttons = buildLinkButtons(
      cfg([
        { id: 'b0', type: 'BOOKING', label: 'Book' },
        { id: 'b1', type: 'BOOKING', label: 'Puppy class', targetId: 'puppy-class' },
        { id: 'l1', type: 'LEADMAGNET', label: 'Free guide', targetId: 'puppy-guide' },
        { id: 'f1', type: 'FORM', label: 'Get in touch', targetId: 'form-123' },
        { id: 's1', type: 'SIGNIN', label: 'Client login' },
        { id: 'w1', type: 'WEBSITE', label: 'Website' },
        { id: 'e1', type: 'EMAIL', label: 'Email us' },
        { id: 'c1', type: 'CALL', label: 'Call us' },
        { id: 'u1', type: 'CUSTOM', label: 'My blog', url: 'blog.com' },
      ]),
      TRAINER,
    )
    const by = (k: string) => buttons.find((b) => b.key === k)!
    expect(by('b0').href).toBe('/c/jess/book')
    expect(by('b0').icon).toBe('calendar')
    expect(by('b0').external).toBe(false)
    expect(by('b1').href).toBe('/c/jess/book/puppy-class')
    expect(by('l1').href).toBe('/c/jess/free/puppy-guide')
    expect(by('l1').icon).toBe('gift')
    expect(by('f1').href).toBe('/form/form-123')
    expect(by('f1').icon).toBe('message')
    expect(by('s1').href).toBe('/c/jess')
    expect(by('s1').icon).toBe('login')
    expect(by('w1').href).toBe('https://jessdogs.com/')
    expect(by('w1').icon).toBe('globe')
    expect(by('w1').external).toBe(true)
    expect(by('e1').href).toBe('mailto:hi@jessdogs.com')
    expect(by('e1').icon).toBe('mail')
    expect(by('c1').href).toBe('tel:0215550000')
    expect(by('c1').icon).toBe('phone')
    expect(by('u1').href).toBe('https://blog.com/')
    expect(by('u1').icon).toBe('link')
    expect(by('u1').external).toBe(true)
  })

  it('buildLinkButtons preserves the row order (order IS the array index)', () => {
    const buttons = buildLinkButtons(
      cfg([
        { id: 'w', type: 'WEBSITE', label: 'Website' },
        { id: 'e', type: 'EMAIL', label: 'Email us' },
        { id: 'b', type: 'BOOKING', label: 'Book' },
        { id: 'u', type: 'CUSTOM', label: 'Blog', url: 'blog.com' },
      ]),
      TRAINER,
    )
    expect(buttons.map((b) => b.key)).toEqual(['w', 'e', 'b', 'u'])
  })

  it('buildLinkButtons skips rows that cannot resolve (missing target / profile field / gate)', () => {
    const buttons = buildLinkButtons(
      cfg([
        { id: 'l', type: 'LEADMAGNET', label: 'Guide' }, // no targetId → skipped
        { id: 'f', type: 'FORM', label: 'Form' }, // no targetId → skipped
        { id: 'w', type: 'WEBSITE', label: 'Website' }, // no website → skipped
        { id: 'e', type: 'EMAIL', label: 'Email' }, // no publicEmail → skipped
        { id: 'c', type: 'CALL', label: 'Call' }, // showPhoneToClients false → skipped
        { id: 'u', type: 'CUSTOM', label: 'Bad', url: 'javascript:alert(1)' }, // unsafe → skipped
        { id: 'g', type: 'CUSTOM', label: 'Good', url: 'good.com' },
      ]),
      { slug: 'jess', website: null, publicEmail: null, phone: '021 555 0000', showPhoneToClients: false },
    )
    expect(buttons.map((b) => b.key)).toEqual(['g'])
  })

  it('buildLinkButtons never exposes an unflagged phone', () => {
    const buttons = buildLinkButtons(
      cfg([{ id: 'c', type: 'CALL', label: 'Call us' }]),
      { slug: 'jess', website: null, publicEmail: null, phone: '021 555 0000', showPhoneToClients: false },
    )
    expect(buttons).toEqual([])
  })

  it('buildLinkButtons skips a row with a blank label', () => {
    const buttons = buildLinkButtons(
      cfg([
        { id: 'e', type: 'EMAIL', label: '   ' },
        { id: 'w', type: 'WEBSITE', label: 'Website' },
      ]),
      TRAINER,
    )
    expect(buttons.map((b) => b.key)).toEqual(['w'])
  })

  it('buildLinkButtons attaches the row per-button style (image/bg/text), dropping bad values', () => {
    const buttons = buildLinkButtons(
      cfg([
        {
          id: 'b',
          type: 'BOOKING',
          label: 'Book',
          imageUrl: 'https://img.test/a.png',
          bgColor: '#ff0000',
          textColor: '#000000',
        },
        { id: 'w', type: 'WEBSITE', label: 'Website', bgColor: 'red', textColor: '#zz0' }, // all bad → no style
        { id: 'e', type: 'EMAIL', label: 'Email' }, // none set → no style
      ]),
      TRAINER,
    )
    const by = (k: string) => buttons.find((b) => b.key === k)!
    expect(by('b').style).toEqual({ imageUrl: 'https://img.test/a.png', bgColor: '#ff0000', textColor: '#000000' })
    expect(by('w').style).toBeUndefined()
    expect(by('e').style).toBeUndefined()
  })

  it('buildLinkButtons keys default to row index when a row has no id', () => {
    const buttons = buildLinkButtons(
      { headline: null, bio: null, instagram: null, facebook: null, tiktok: null, links: [{ type: 'EMAIL', label: 'Email us' }] },
      TRAINER,
    )
    expect(buttons[0].key).toBe('row-0')
  })

  it('buildSocialLinks returns the icon-row entries (platform + href), not buttons', () => {
    const socials = buildSocialLinks({ instagram: '@jess', facebook: 'jessdogs', tiktok: null })
    expect(socials).toEqual([
      { platform: 'instagram', href: 'https://instagram.com/jess' },
      { platform: 'facebook', href: 'https://facebook.com/jessdogs' },
    ])
    expect(buildSocialLinks({ instagram: null, facebook: null, tiktok: null })).toEqual([])
  })

  it('validates font ids and resolves their CSS stacks', () => {
    expect(isLinkPageFontId('default')).toBe(true)
    expect(isLinkPageFontId('rounded')).toBe(true)
    expect(isLinkPageFontId('comic-sans')).toBe(false)
    expect(isLinkPageFontId(null)).toBe(false)
    expect(linkPageFontStack(null)).toBe(LINK_PAGE_FONTS[0].stack)
    expect(linkPageFontStack('nope')).toBe(LINK_PAGE_FONTS[0].stack)
    expect(linkPageFontStack('rounded')).toBe('var(--font-baloo)')
  })
})

describe('instagram add-on registration', () => {
  it('is a known FREE add-on that never goes through checkout', () => {
    expect(isAddonId('instagram')).toBe(true)
    expect(addonById('instagram')?.name).toBe('Instagram')
    expect(isFreeAddon('instagram')).toBe(true)
    expect(isSellableAddon('instagram')).toBe(false)
    expect(Object.values(addonById('instagram')!.price).every((p) => p === 0)).toBe(true)
  })
})

// ── PATCH route: validation + button replacement ────────────────────────────
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  requireSameOrigin: vi.fn((): Response | null => null),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: h.requireSameOrigin }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    linkPage: { findUnique: h.findUnique, upsert: h.upsert },
    linkPageButton: { deleteMany: h.deleteMany, createMany: h.createMany },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        linkPage: { upsert: h.upsert, findUnique: h.findUnique },
        linkPageButton: { deleteMany: h.deleteMany, createMany: h.createMany },
      }),
  },
}))

import { PATCH, GET } from '@/app/api/trainer/link-page/route'

function asOwner(companyId = 't-1') {
  h.guardPermission.mockResolvedValue({ userId: 'u-1', companyId, membershipId: 'm-1', role: 'OWNER', permissions: {} })
}
function patchReq(body: unknown) {
  return new Request('http://localhost/api/trainer/link-page', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSameOrigin.mockReturnValue(null)
  h.upsert.mockResolvedValue({ id: 'lp-1', trainerId: 't-1' })
  h.deleteMany.mockResolvedValue({ count: 0 })
  h.createMany.mockResolvedValue({ count: 0 })
  h.findUnique.mockResolvedValue({ id: 'lp-1', trainerId: 't-1', links: [] })
})

describe('PATCH /api/trainer/link-page', () => {
  it('replaces the button set, assigns order by index, and persists every field', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({
      buttons: [
        { type: 'BOOKING', label: 'Book', targetId: 'puppy-class', bgColor: '#112233' },
        { type: 'CUSTOM', label: 'Blog', url: 'blog.com', imageUrl: 'https://img.test/x.png' },
        { type: 'EMAIL', label: 'Email us' },
      ],
    }))
    expect(res.status).toBe(200)
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { linkPageId: 'lp-1' } })
    expect(h.createMany).toHaveBeenCalledWith({
      data: [
        {
          linkPageId: 'lp-1', type: 'BOOKING', label: 'Book', url: null, targetId: 'puppy-class',
          imageUrl: null, bgColor: '#112233', textColor: null, order: 0,
        },
        {
          linkPageId: 'lp-1', type: 'CUSTOM', label: 'Blog', url: 'https://blog.com/', targetId: null,
          imageUrl: 'https://img.test/x.png', bgColor: null, textColor: null, order: 1,
        },
        {
          linkPageId: 'lp-1', type: 'EMAIL', label: 'Email us', url: null, targetId: null,
          imageUrl: null, bgColor: null, textColor: null, order: 2,
        },
      ],
    })
  })

  it('drops url for non-CUSTOM types and targetId for types that do not address a target', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({
      buttons: [
        // A stray url/targetId on a SIGNIN button is ignored on write.
        { type: 'SIGNIN', label: 'Login', url: 'https://evil.test', targetId: 'nope' },
      ],
    }))
    expect(res.status).toBe(200)
    const data = h.createMany.mock.calls[0][0].data
    expect(data[0].url).toBeNull()
    expect(data[0].targetId).toBeNull()
  })

  it('accepts the styling fields (font, backgroundUrl, socialsLabel) and normalises them', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({
      font: 'rounded',
      backgroundUrl: 'cdn.example.com/bg.jpg',
      socialsLabel: '  Connect with us  ',
    }))
    expect(res.status).toBe(200)
    const call = h.upsert.mock.calls[0][0]
    expect(call.update.font).toBe('rounded')
    expect(call.update.backgroundUrl).toBe('https://cdn.example.com/bg.jpg')
    expect(call.update.socialsLabel).toBe('Connect with us')
  })

  it('empties the styling fields to null when blank', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({ font: '', backgroundUrl: '', socialsLabel: '   ' }))
    expect(res.status).toBe(200)
    const call = h.upsert.mock.calls[0][0]
    expect(call.update.font).toBeNull()
    expect(call.update.backgroundUrl).toBeNull()
    expect(call.update.socialsLabel).toBeNull()
  })

  it('does not touch the button set when `buttons` is absent', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({ headline: 'Hi' }))
    expect(res.status).toBe(200)
    expect(h.deleteMany).not.toHaveBeenCalled()
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('clears all buttons when given an empty array', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({ buttons: [] }))
    expect(res.status).toBe(200)
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { linkPageId: 'lp-1' } })
    expect(h.createMany).not.toHaveBeenCalled()
  })

  it('rejects an unknown button type with 400', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({ buttons: [{ type: 'WAT', label: 'x' }] }))
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects a CUSTOM button without a valid http(s) url with 400', async () => {
    asOwner('t-1')
    const bad = await PATCH(patchReq({ buttons: [{ type: 'CUSTOM', label: 'Bad', url: 'javascript:alert(1)' }] }))
    expect(bad.status).toBe(400)
    const missing = await PATCH(patchReq({ buttons: [{ type: 'CUSTOM', label: 'Bad' }] }))
    expect(missing.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects a blank button label with 400', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({ buttons: [{ type: 'EMAIL', label: '   ' }] }))
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects an invalid button colour with 400', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({ buttons: [{ type: 'EMAIL', label: 'Email', bgColor: 'red' }] }))
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects a non-http(s) button imageUrl with 400', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({ buttons: [{ type: 'EMAIL', label: 'Email', imageUrl: 'javascript:alert(1)' }] }))
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('rejects an unknown font id with 400', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({ font: 'comic-sans' }))
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('blocks a cross-site (CSRF) request', async () => {
    asOwner()
    h.requireSameOrigin.mockReturnValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await PATCH(patchReq({ buttons: [] }))
    expect(res.status).toBe(403)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('401s when the permission guard fails', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }))
    const res = await PATCH(patchReq({ buttons: [] }))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('is tenant-scoped: upserts under the caller and ignores a smuggled trainerId', async () => {
    asOwner('me')
    await PATCH(patchReq({ trainerId: 'victim', linkPageId: 'lp-victim', buttons: [] }))
    const call = h.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ trainerId: 'me' })
    expect(call.create.trainerId).toBe('me')
    expect(JSON.stringify(call)).not.toContain('victim')
  })
})

describe('GET /api/trainer/link-page', () => {
  it('returns the caller-scoped link page', async () => {
    asOwner('t-1')
    h.findUnique.mockResolvedValue({ id: 'lp-1', trainerId: 't-1', links: [] })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.findUnique).toHaveBeenCalledWith({
      where: { trainerId: 't-1' },
      include: { links: { orderBy: { order: 'asc' } } },
    })
  })
})
