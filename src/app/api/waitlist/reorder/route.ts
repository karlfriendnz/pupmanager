import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

// POST /api/waitlist/reorder — { ids: [...] } top-to-bottom. Sets
// priority = index so lower = higher up the list. Mirrors the
// packages/reorder pattern.
const schema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
})

export async function POST(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const parsed = schema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const owned = await prisma.waitlistEntry.findMany({
    where: { trainerId, id: { in: parsed.data.ids } },
    select: { id: true },
  })
  if (owned.length !== parsed.data.ids.length) {
    return NextResponse.json({ error: 'Some entries were not found' }, { status: 404 })
  }

  await prisma.$transaction(
    parsed.data.ids.map((id, index) =>
      prisma.waitlistEntry.update({ where: { id }, data: { priority: index } }),
    ),
  )
  return NextResponse.json({ ok: true })
}
