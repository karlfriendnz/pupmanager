import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  // Ordered list of package IDs from top to bottom.
  ids: z.array(z.string().min(1)).min(1).max(500),
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

  // Verify every supplied id belongs to this trainer (prevents cross-trainer writes)
  const owned = await prisma.package.findMany({
    where: { trainerId, id: { in: parsed.data.ids } },
    select: { id: true },
  })
  if (owned.length !== parsed.data.ids.length) {
    return NextResponse.json({ error: 'Some packages were not found' }, { status: 404 })
  }

  await prisma.$transaction(
    parsed.data.ids.map((id, index) =>
      prisma.package.update({ where: { id }, data: { order: index } })
    )
  )

  return NextResponse.json({ ok: true })
}
