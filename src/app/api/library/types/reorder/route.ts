import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// The order the Library's categories appear in — the same shape as the shop's
// shelf reorder: ids in their new order, index becomes `order`.
//
// That order is the one the navigation tree and every category picker read, so
// this is the trainer arranging their own library rather than a display
// preference. `forms.manage` gates it, matching the POST that creates a
// category one route up.
export const runtime = 'nodejs'

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(200) })

export async function POST(req: Request) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const { ids } = parsed.data

  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Duplicate ids' }, { status: 400 })
  }

  // Every id has to be this trainer's. Counting first means a list with one
  // borrowed id writes nothing at all, rather than reordering the trainer's own
  // categories and failing on the stranger.
  const mine = await prisma.libraryType.count({
    where: { id: { in: ids }, trainerId: guard.companyId },
  })
  if (mine !== ids.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.libraryType.update({ where: { id }, data: { order: index } }),
    ),
  )
  return NextResponse.json({ ok: true })
}
