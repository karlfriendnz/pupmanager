import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// The order the themes appear in inside a category. Same shape as the category
// reorder a level up: ids in their new order, index becomes `order`.
//
// The order is scoped by the parent — getLibraryTree reads each type's themes
// `orderBy: order` — so the indices only ever have to be consistent within one
// category, which is the only place the UI can drag them.
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

  // Ownership is a level up: a theme belongs to a type, and the type belongs to
  // a trainer. Counting first means a list with one borrowed id writes nothing
  // at all, rather than reordering the caller's own and failing on the stranger.
  const mine = await prisma.libraryTheme.count({
    where: { id: { in: ids }, type: { trainerId: guard.companyId } },
  })
  if (mine !== ids.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.libraryTheme.update({ where: { id }, data: { order: index } }),
    ),
  )
  return NextResponse.json({ ok: true })
}
