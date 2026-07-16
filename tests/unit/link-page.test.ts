import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

// ── Pure helpers ────────────────────────────────────────────────────────────
import { buildLinkButtons, socialUrl, safeExternalUrl, isHttpUrl } from '@/lib/link-page'
import { addonById, isFreeAddon, isSellableAddon, isAddonId } from '@/lib/pricing'

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

  it('socialUrl normalises handles and passes through full URLs', () => {
    expect(socialUrl('instagram', '@jess')).toBe('https://instagram.com/jess')
    expect(socialUrl('facebook', 'jessdogs')).toBe('https://facebook.com/jessdogs')
    expect(socialUrl('tiktok', '@jess')).toBe('https://tiktok.com/@jess')
    expect(socialUrl('instagram', 'https://instagram.com/jess')).toBe('https://instagram.com/jess')
    expect(socialUrl('instagram', '')).toBeNull()
    expect(socialUrl('instagram', null)).toBeNull()
  })

  it('buildLinkButtons orders Book → custom → website → socials → contact and gates phone', () => {
    const buttons = buildLinkButtons(
      {
        headline: null,
        bio: null,
        showBooking: true,
        showWebsite: true,
        showContact: true,
        instagram: '@jess',
        facebook: null,
        tiktok: null,
        links: [{ label: 'Guide', url: 'guide.com' }],
      },
      {
        slug: 'jess',
        website: 'jessdogs.com',
        publicEmail: 'hi@jessdogs.com',
        phone: '021 555 0000',
        showPhoneToClients: true,
      },
    )
    expect(buttons.map((b) => b.key)).toEqual(['book', 'link-0', 'website', 'instagram', 'email', 'call'])
    expect(buttons[0].href).toBe('/c/jess/book')
    expect(buttons.find((b) => b.key === 'link-0')!.href).toBe('https://guide.com/')
    expect(buttons.find((b) => b.key === 'call')!.href).toBe('tel:0215550000')
    // Custom + website + social are external; book/email/call are not.
    expect(buttons.find((b) => b.key === 'website')!.external).toBe(true)
    expect(buttons.find((b) => b.key === 'email')!.external).toBe(false)
  })

  it('never exposes an unflagged phone, and honours the on/off toggles', () => {
    const buttons = buildLinkButtons(
      {
        headline: null,
        bio: null,
        showBooking: false,
        showWebsite: false,
        showContact: true,
        instagram: null,
        facebook: null,
        tiktok: null,
        links: [],
      },
      {
        slug: 'jess',
        website: 'jessdogs.com',
        publicEmail: 'hi@jessdogs.com',
        phone: '021 555 0000',
        showPhoneToClients: false, // not shared → no Call button
      },
    )
    // No book (off), no website (off), only Email (phone withheld).
    expect(buttons.map((b) => b.key)).toEqual(['email'])
  })

  it('drops custom links with a non-http(s) url or empty label', () => {
    const buttons = buildLinkButtons(
      {
        headline: null, bio: null, showBooking: false, showWebsite: false, showContact: false,
        instagram: null, facebook: null, tiktok: null,
        links: [
          { label: 'Bad', url: 'javascript:alert(1)' },
          { label: '', url: 'ok.com' },
          { label: 'Good', url: 'good.com' },
        ],
      },
      { slug: 'jess', website: null, publicEmail: null, phone: null, showPhoneToClients: false },
    )
    expect(buttons.map((b) => b.label)).toEqual(['Good'])
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

// ── PATCH route: validation + link replacement ──────────────────────────────
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
  it('replaces the link set and assigns order by array index', async () => {
    asOwner('t-1')
    const res = await PATCH(patchReq({
      showBooking: true,
      links: [
        { label: 'First', url: 'first.com' },
        { label: 'Second', url: 'https://second.com' },
      ],
    }))
    expect(res.status).toBe(200)
    // Whole set replaced under the caller's link page.
    expect(h.deleteMany).toHaveBeenCalledWith({ where: { linkPageId: 'lp-1' } })
    expect(h.createMany).toHaveBeenCalledWith({
      data: [
        { linkPageId: 'lp-1', label: 'First', url: 'https://first.com/', order: 0 },
        { linkPageId: 'lp-1', label: 'Second', url: 'https://second.com/', order: 1 },
      ],
    })
  })

  it('rejects a non-http(s) link url with 400', async () => {
    asOwner()
    const res = await PATCH(patchReq({ links: [{ label: 'Bad', url: 'javascript:alert(1)' }] }))
    expect(res.status).toBe(400)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('blocks a cross-site (CSRF) request', async () => {
    asOwner()
    h.requireSameOrigin.mockReturnValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    const res = await PATCH(patchReq({ showBooking: false }))
    expect(res.status).toBe(403)
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('401s when the permission guard fails', async () => {
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }))
    const res = await PATCH(patchReq({ showBooking: false }))
    expect(res.status).toBe(401)
    expect(h.upsert).not.toHaveBeenCalled()
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
