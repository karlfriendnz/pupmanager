import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * A picture on an offering CATEGORY, and the one thing that must never happen
 * to it.
 *
 * An offering's cover image has been silently wiped TWICE in this codebase by a
 * save that simply didn't mention it (AGENTS.md, "a field the user typed must
 * survive a reload"). So the interesting tests here are not "does it save" —
 * they are "does it survive a save of the thing NEXT to it", and "can it still
 * be deliberately removed". Those two pull in opposite directions and the only
 * way to have both is for ABSENT and CLEARED to be different things at the wire.
 *
 * The fake trainer_profiles row below is real state, not an assertion on a spy:
 * a "reload" here re-reads what the route actually wrote, which is the only
 * proof that means anything.
 */

const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  auth: vi.fn(),
  update: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({
  guardPermission: h.guardPermission,
  guardAnyPermission: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/prisma', () => ({ prisma: { trainerProfile: { update: h.update } } }))

import { PUT } from '@/app/api/trainer/nav-labels/route'
import { Prisma } from '@/generated/prisma'
import {
  NAV_IMAGE_CATALOG, RENAMEABLE_CATALOG, isImageable, isRenameable,
  sanitizeNavImages, navImageFor,
} from '@/lib/nav-labels'
import { sanitizeImageUrl } from '@/lib/image-url'

const TRAINER = 'trainer_1'
const PIC = 'https://blob.example.com/puppy-class.jpg'
const OTHER_PIC = 'https://blob.example.com/agility.jpg'

/** The stored columns, as a database would hold them. */
let stored: { navLabels: unknown; navImages: unknown }

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks keeps implementations, and one test below makes this one
  // throw — reset it so that doesn't leak into the next test's expectations.
  h.revalidatePath.mockReset()
  stored = { navLabels: null, navImages: null }
  h.guardPermission.mockResolvedValue({ companyId: TRAINER })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', trainerId: TRAINER } })
  // Writes only the keys the route actually put in `data` — which is the whole
  // question. A column the route left out keeps whatever was in it.
  h.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    for (const [col, value] of Object.entries(data)) {
      stored[col as 'navLabels' | 'navImages'] = value === Prisma.DbNull ? null : value
    }
    return { id: TRAINER }
  })
})

const put = (body: unknown) =>
  PUT(new Request('https://app.pupmanager.com/api/trainer/nav-labels', {
    method: 'PUT',
    body: JSON.stringify(body),
  }))

/** What the trainer's own settings screen would show on a fresh load. */
const reload = () => sanitizeNavImages(stored.navImages)

describe('which rows may carry a picture', () => {
  // A picture control on a row no client ever sees is a control that changes
  // nothing — the trainer uploads one and then goes looking for where it went.
  it('is exactly the four ways in the client is shown', () => {
    expect([...NAV_IMAGE_CATALOG]).toEqual(['/packages', '/classes', '/events', '/memberships'])
  })

  it('offers no picture for anything else in the menu', () => {
    expect(isImageable('/library')).toBe(false)
    expect(isImageable('/products')).toBe(false)
    expect(isImageable('section:programs')).toBe(false)
    expect(isImageable('/finances')).toBe(false)
  })

  // The picture and the word are the same row, so a key that can carry one must
  // be a key the trainer is allowed to touch at all.
  it('only picks keys the trainer may also rename', () => {
    for (const key of NAV_IMAGE_CATALOG) {
      const entry = RENAMEABLE_CATALOG.find(e => e.key === key)
      expect(entry, `${key} is not in the renameable catalogue`).toBeTruthy()
      expect(isRenameable(key, entry!.defaultLabel)).toBe(true)
    }
  })
})

describe('what may be stored as a picture', () => {
  it('keeps an ordinary https URL', () => {
    expect(sanitizeImageUrl(PIC)).toBe(PIC)
  })

  // These land in an <img src> on a CLIENT's screen. The trainer authors, the
  // client views — same boundary as a description.
  it('refuses anything that is not http(s)', () => {
    expect(sanitizeImageUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeImageUrl('data:image/svg+xml;base64,AAA')).toBeNull()
    expect(sanitizeImageUrl('//evil.example.com/x.jpg')).toBeNull()
    expect(sanitizeImageUrl('/uploads/x.jpg')).toBeNull()
    expect(sanitizeImageUrl(42)).toBeNull()
    expect(sanitizeImageUrl(null)).toBeNull()
  })

  it('drops a picture keyed on something no client sees', () => {
    expect(sanitizeNavImages({ '/library': PIC, '/classes': PIC })).toEqual({ '/classes': PIC })
  })

  // One representation of "no picture", so it can't mean two things depending
  // on how it got there.
  it('drops a key whose value is empty, so cleared is always absent', () => {
    expect(sanitizeNavImages({ '/classes': '', '/events': null })).toEqual({})
  })
})

describe('borrowing is the fallback, not a deleted branch', () => {
  // null out of navImageFor is the signal the wizard falls through to
  // firstImage(...) on. Nothing set must keep meaning "borrow one".
  it('returns null when the trainer has set nothing', () => {
    expect(navImageFor('/classes', {})).toBeNull()
    expect(navImageFor('/classes', null)).toBeNull()
    expect(navImageFor('/classes', undefined)).toBeNull()
  })

  it('returns their picture once they set one', () => {
    expect(navImageFor('/classes', { '/classes': PIC })).toBe(PIC)
  })

  it('still refuses a key that isn’t a client-facing way in', () => {
    expect(navImageFor('/library', { '/library': PIC })).toBeNull()
  })
})

describe('a picture survives a reload', () => {
  it('is still there after save → reload', async () => {
    const res = await put({ images: { '/classes': PIC } })
    expect(res.status).toBe(200)
    expect(reload()).toEqual({ '/classes': PIC })
  })

  /**
   * THE BUG, in the exact shape it has taken twice: a save that only carries
   * the NAME must not take the picture with it.
   */
  it('is still there after a save that only renamed the row', async () => {
    await put({ images: { '/classes': PIC } })
    expect(reload()).toEqual({ '/classes': PIC })

    const res = await put({ labels: { '/classes': 'Courses' } })
    expect(res.status).toBe(200)

    // The name landed…
    expect(stored.navLabels).toEqual({ '/classes': 'Courses' })
    // …and the picture is exactly where it was.
    expect(reload()).toEqual({ '/classes': PIC })
  })

  // The mirror image, because a caller that sends only pictures must not blank
  // the trainer's words either.
  it('leaves the names alone when only pictures are sent', async () => {
    await put({ labels: { '/classes': 'Courses' } })
    const res = await put({ images: { '/classes': PIC } })
    expect(res.status).toBe(200)
    expect(stored.navLabels).toEqual({ '/classes': 'Courses' })
  })

  // Absent means absent: the route must not even touch the column.
  it('does not write navImages at all when images is not sent', async () => {
    await put({ labels: { '/classes': 'Courses' } })
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0].data).not.toHaveProperty('navImages')
  })

  it('does nothing at all when a body mentions neither', async () => {
    await put({})
    expect(h.update).not.toHaveBeenCalled()
  })
})

describe('clearing a picture', () => {
  // Distinguishable from "not sent": the map is PRESENT and the key is gone.
  it('removes it when the map arrives without that key', async () => {
    await put({ images: { '/classes': PIC, '/events': OTHER_PIC } })
    expect(reload()).toEqual({ '/classes': PIC, '/events': OTHER_PIC })

    await put({ images: { '/events': OTHER_PIC } })
    expect(reload()).toEqual({ '/events': OTHER_PIC })
  })

  it('empties the column when the last one goes', async () => {
    await put({ images: { '/classes': PIC } })
    await put({ images: {} })
    expect(stored.navImages).toBeNull()
    expect(reload()).toEqual({})
  })

  // And once cleared, the row is back to borrowing — the fallback was never
  // removed, only overridden.
  it('goes back to borrowing once cleared', async () => {
    await put({ images: { '/classes': PIC } })
    await put({ images: {} })
    expect(navImageFor('/classes', reload())).toBeNull()
  })
})

describe('who may set one', () => {
  it('refuses anyone without settings.edit', async () => {
    const { NextResponse } = await import('next/server')
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await put({ images: { '/classes': PIC } })
    expect(res.status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('refuses a client session', async () => {
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'u1' } })
    const res = await put({ images: { '/classes': PIC } })
    expect(res.status).toBe(401)
    expect(h.update).not.toHaveBeenCalled()
  })

  // The column is only ever written for the session's OWN business — there is
  // no trainer id on the wire to point somewhere else.
  it('writes only to the caller’s own trainer profile', async () => {
    await put({ images: { '/classes': PIC } })
    expect(h.update.mock.calls[0][0].where).toEqual({ id: TRAINER })
  })
})

describe('a failed revalidation never fails the save', () => {
  // The save has already happened. A throw here would tell a trainer their
  // picture hadn't saved when it had, and invite them to do it again.
  it('still answers 200 when revalidatePath throws', async () => {
    h.revalidatePath.mockImplementation(() => { throw new Error('no such route') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await put({ images: { '/classes': PIC } })
    expect(res.status).toBe(200)
    expect(reload()).toEqual({ '/classes': PIC })
    err.mockRestore()
  })

  it('clears the client screens that draw the row', async () => {
    await put({ images: { '/classes': PIC } })
    const paths = h.revalidatePath.mock.calls.map(c => c[0])
    expect(paths).toContain('/my-availability')
    expect(paths).toContain('/home')
  })
})
