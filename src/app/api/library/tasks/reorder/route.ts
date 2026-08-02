import { NextResponse } from 'next/server'
import { z } from 'zod'

import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

// The order the items appear in inside a theme — the bottom of the Library's
// three levels, and the one a client feels: this is the order the exercises are
// offered in when a trainer picks homework to hand out.
export const runtime = 'nodejs'

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) })

export async function POST(req: Request) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
  const { ids } = parsed.data

  if (new Set(ids).size !== ids.length) {
    return NextResponse.json({ error: 'Duplicate ids' }, { status: 400 })
  }

  // Ownership is two levels up — item → theme → type → trainer. Counting first
  // means a list with one borrowed id writes nothing at all.
  const mine = await prisma.libraryTask.count({
    where: { id: { in: ids }, theme: { type: { trainerId: guard.companyId } } },
  })
  if (mine !== ids.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.libraryTask.update({ where: { id }, data: { order: index } }),
    ),
  )
  return NextResponse.json({ ok: true })
}
