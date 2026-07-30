import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@/generated/prisma'
import { sanitizeNavLabels } from '@/lib/nav-labels'

/**
 * What this trainer calls the things in their own left menu.
 *
 * The body is the WHOLE map, not a patch: the editor saves the form it's showing,
 * and a rename cleared back to our word has to be able to disappear. sanitize
 * decides what's storable — anything blank, unchanged, over-long, or naming
 * something locked (Stripe, Finances, Reports…) is dropped rather than saved, so
 * the column can't accumulate junk that shadows a future default.
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

  const labels = sanitizeNavLabels((body as { labels?: unknown } | null)?.labels)

  await prisma.trainerProfile.update({
    where: { id: trainerId },
    // An empty map is stored as SQL NULL so "no renames" has one representation
    // rather than two (DbNull, not JsonNull — the column, not a JSON `null`).
    data: { navLabels: Object.keys(labels).length > 0 ? labels : Prisma.DbNull },
  })

  // The left menu is rendered by the trainer LAYOUT, a server component that
  // reads navLabels once per render and is cached. Without this, a rename saves
  // to the database and the menu keeps showing our word until the cache happens
  // to expire — which reads as "the setting doesn't work".
  //
  // 'layout' (not the default 'page') is the load-bearing part: the nav lives in
  // the layout, so revalidating only the page it was saved from would refresh
  // the settings screen and leave the menu beside it stale.
  revalidatePath('/', 'layout')

  return NextResponse.json({ labels })
}
