import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma'
import { sanitizeNavLabels, sanitizeNavImages } from '@/lib/nav-labels'

/**
 * What this trainer calls the things in their own left menu — and, since
 * 2026-08-06, what picture goes on them.
 *
 * The body is the WHOLE map, not a patch: the editor saves the form it's showing,
 * and a rename cleared back to our word has to be able to disappear. sanitize
 * decides what's storable — anything blank, unchanged, over-long, or naming
 * something locked (Stripe, Finances, Reports…) is dropped rather than saved, so
 * the column can't accumulate junk that shadows a future default.
 *
 * TWO KEYS, EACH OPTIONAL, AND THE DIFFERENCE IS LOAD-BEARING:
 *
 *   • `labels` / `images` ABSENT  → that column is not written at all.
 *   • `labels` / `images` PRESENT → it is the whole map, and a key missing from
 *     it is a CLEARED value.
 *
 * That first line is the guard against this codebase's most-repeated bug: an
 * offering's cover image has twice been silently wiped by a save that simply
 * didn't mention it. A caller that sends only `labels` must be able to rename a
 * row without touching its picture, and the only way to guarantee that is for
 * "not sent" and "cleared" to be different things at the wire. Tested both ways
 * in tests/unit/nav-images.test.ts — do not collapse them.
 */
export async function PUT(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const payload = (body ?? {}) as { labels?: unknown; images?: unknown }

  // `in`, not a truthiness check: `{ labels: {} }` means "clear every rename",
  // which is a real thing to ask for and reads as absent to `?? undefined`.
  const sendsLabels = 'labels' in payload
  const sendsImages = 'images' in payload

  const labels = sanitizeNavLabels(payload.labels)
  const images = sanitizeNavImages(payload.images)

  const data: { navLabels?: typeof labels | typeof Prisma.DbNull; navImages?: typeof images | typeof Prisma.DbNull } = {}
  // An empty map is stored as SQL NULL so "no renames" has one representation
  // rather than two (DbNull, not JsonNull — the column, not a JSON `null`).
  if (sendsLabels) data.navLabels = Object.keys(labels).length > 0 ? labels : Prisma.DbNull
  if (sendsImages) data.navImages = Object.keys(images).length > 0 ? images : Prisma.DbNull

  // A body mentioning neither is a no-op, not an excuse to blank both.
  if (sendsLabels || sendsImages) {
    await prisma.trainerProfile.update({ where: { id: trainerId }, data })
  }

  revalidateNamingScreens()

  // Only what was actually written is echoed back, so the editor settles its
  // boxes to the truth without a save of one half appearing to blank the other.
  return NextResponse.json({
    ...(sendsLabels ? { labels } : {}),
    ...(sendsImages ? { images } : {}),
  })
}

/**
 * Everything that renders a trainer's own words or pictures.
 *
 * The left menu is rendered by the trainer LAYOUT, a server component that reads
 * navLabels once per render and is cached. Without this, a rename saves to the
 * database and the menu keeps showing our word until the cache happens to
 * expire — which reads as "the setting doesn't work". 'layout' (not the default
 * 'page') is the load-bearing part: the nav lives in the layout, so revalidating
 * only the page it was saved from would refresh the settings screen and leave
 * the menu beside it stale.
 *
 * The client screens are named on top of it because a picture set here is FOR
 * them: /my-availability draws the category rows and /home draws the tile that
 * borrows the same word.
 */
function revalidateNamingScreens() {
  // Never allowed to fail the request — the save has already happened. A throw
  // from here would tell a trainer their names hadn't saved when they had, and
  // invite them to do it again. A stale screen is the smaller problem, and it
  // clears on its own. (Same pattern as api/dogs/[dogId]/photo.)
  try {
    revalidatePath('/', 'layout')
    for (const path of ['/my-availability', '/home']) revalidatePath(path)
  } catch (err) {
    console.error('Nav label/image revalidation failed (the setting itself saved):', err)
  }
}
