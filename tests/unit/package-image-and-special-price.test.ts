import { describe, it, expect, vi, beforeEach } from 'vitest'

// Two rules the offering form kept getting wrong, pinned at the API — which is
// where they actually have to hold, because the form isn't the only caller.
//
//  1. The cover image is optional-means-"leave it alone". The old
//     `imageUrl: imageUrl ?? null` couldn't tell "clear it" (an explicit null)
//     from "I didn't mention it" (undefined), so every save that omitted the
//     key — which is exactly what a 1:1 offering's form sent — silently wiped
//     the picture the trainer had uploaded.
//  2. A special price is a DISCOUNT. Above the normal price it's shown as a
//     saving and charged as an increase, so it's refused.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  pkgFindFirst: vi.fn(),
  pkgFindUnique: vi.fn(),
  pkgUpdate: vi.fn(),
  pkgCreate: vi.fn(),
  pkgAggregate: vi.fn(),
  pkgFindMany: vi.fn(),
  classRunCount: vi.fn(),
  classRunFindMany: vi.fn(),
  clientPackageCount: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => {
  const tx = {
    package: {
      findFirst: h.pkgFindFirst,
      findUnique: h.pkgFindUnique,
      findMany: h.pkgFindMany,
      update: h.pkgUpdate,
      create: h.pkgCreate,
      aggregate: h.pkgAggregate,
    },
    classRun: { count: h.classRunCount, findMany: h.classRunFindMany },
    clientPackage: { count: h.clientPackageCount },
  }
  return { prisma: { ...tx, $transaction: (fn: (c: typeof tx) => unknown) => fn(tx) } }
})

import { PATCH } from '@/app/api/packages/[packageId]/route'
import { POST } from '@/app/api/packages/route'
import { isValidSpecialPrice } from '@/lib/special-price'

const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/packages/pkg_1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ packageId: 'pkg_1' }) })

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

const NEW_OFFERING = {
  name: 'Loose-Leash Bootcamp',
  sessionCount: 3,
  weeksBetween: 1,
  durationMins: 45,
}

const IMAGE = 'https://blob.example.com/trainer-images/tr_me/cover.jpg'

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue(undefined)
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u', trainerId: 'tr_me' } })
  // The stored package: it already has a cover image and a price.
  h.pkgFindFirst.mockResolvedValue({
    id: 'pkg_1', imageUrl: IMAGE, priceCents: 20000, specialPriceCents: null,
  })
  h.classRunCount.mockResolvedValue(0)
  h.classRunFindMany.mockResolvedValue([])
  h.clientPackageCount.mockResolvedValue(0)
  h.pkgAggregate.mockResolvedValue({ _max: { order: 0 } })
  h.pkgUpdate.mockImplementation(async ({ data }) => ({ id: 'pkg_1', ...data }))
  h.pkgCreate.mockImplementation(async ({ data }) => ({ id: 'pkg_new', ...data }))
})

describe('the offering cover image survives a save that never mentions it', () => {
  it('leaves imageUrl untouched when the key is absent', async () => {
    const res = await patch({ name: 'Renamed' })
    expect(res.status).toBe(200)
    expect(h.pkgUpdate.mock.calls[0][0].data).not.toHaveProperty('imageUrl')
  })

  it('still clears it when the caller explicitly sends null', async () => {
    await patch({ imageUrl: null })
    expect(h.pkgUpdate.mock.calls[0][0].data.imageUrl).toBeNull()
  })

  it('writes a new image when one is sent', async () => {
    await patch({ imageUrl: IMAGE })
    expect(h.pkgUpdate.mock.calls[0][0].data.imageUrl).toBe(IMAGE)
  })

  // The bug that started this: a 1:1 offering's form sends no isGroup and no
  // imageUrl, which used to be read as "wipe the picture".
  it('a plain 1:1 edit does not wipe the picture', async () => {
    await patch({ name: 'Loose-Leash Bootcamp', durationMins: 45, priceCents: 20000 })
    expect(h.pkgUpdate.mock.calls[0][0].data).not.toHaveProperty('imageUrl')
  })

  it('stores the image on create, group or not', async () => {
    await post({ ...NEW_OFFERING, imageUrl: IMAGE })
    expect(h.pkgCreate.mock.calls[0][0].data.imageUrl).toBe(IMAGE)
  })
})

describe('a special price cannot be higher than the price', () => {
  it('refuses it on create', async () => {
    const res = await post({ ...NEW_OFFERING, priceCents: 10000, specialPriceCents: 25000 })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/discount/i)
    expect(h.pkgCreate).not.toHaveBeenCalled()
  })

  it('refuses it on edit', async () => {
    const res = await patch({ priceCents: 10000, specialPriceCents: 25000 })
    expect(res.status).toBe(400)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  // The half-patch is the one a client-side check can't catch: raise only the
  // special price and the stored price is what it has to be measured against.
  it('measures a special-price-only patch against the STORED price', async () => {
    const res = await patch({ specialPriceCents: 30000 }) // stored price is 20000
    expect(res.status).toBe(400)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  it('measures a price-only patch against the STORED special price', async () => {
    h.pkgFindFirst.mockResolvedValue({ id: 'pkg_1', imageUrl: null, priceCents: 20000, specialPriceCents: 15000 })
    const res = await patch({ priceCents: 10000 }) // would leave special 15000 > price 10000
    expect(res.status).toBe(400)
    expect(h.pkgUpdate).not.toHaveBeenCalled()
  })

  it('allows a genuine discount', async () => {
    const res = await patch({ priceCents: 20000, specialPriceCents: 15000 })
    expect(res.status).toBe(200)
    expect(h.pkgUpdate).toHaveBeenCalled()
  })

  it('allows the same price twice', async () => {
    expect((await patch({ priceCents: 20000, specialPriceCents: 20000 })).status).toBe(200)
  })

  it('allows clearing the special price', async () => {
    expect((await patch({ specialPriceCents: null })).status).toBe(200)
  })

  // A drop-in has no headline price — each slot prices itself, so the rule has
  // to reach into the schedule or it simply doesn't apply to that whole kind.
  it('refuses an over-priced special on a drop-in slot', async () => {
    const slot = { day: 2, startTime: '15:00', endTime: '16:00', priceCents: 2000, specialPriceCents: 5000 }
    expect((await patch({ sessionSlots: [slot] })).status).toBe(400)
    expect((await post({ ...NEW_OFFERING, sessionSlots: [slot] })).status).toBe(400)
  })
})

describe('isValidSpecialPrice', () => {
  it('is happy with nothing to compare', () => {
    expect(isValidSpecialPrice(null, null)).toBe(true)
    // No normal price = nothing for the special to discount; a half-filled form
    // shouldn't be refused mid-typing.
    expect(isValidSpecialPrice(null, 500)).toBe(true)
    expect(isValidSpecialPrice(500, null)).toBe(true)
    expect(isValidSpecialPrice(500, undefined)).toBe(true)
  })

  it('allows lower and equal, refuses higher', () => {
    expect(isValidSpecialPrice(500, 499)).toBe(true)
    expect(isValidSpecialPrice(500, 500)).toBe(true)
    expect(isValidSpecialPrice(500, 501)).toBe(false)
  })

  it('treats free as a real price, not a missing one', () => {
    expect(isValidSpecialPrice(0, 0)).toBe(true)
    expect(isValidSpecialPrice(0, 100)).toBe(false)
  })
})
