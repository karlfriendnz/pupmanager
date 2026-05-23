import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  ids: z.array(z.string()),
})

async function getTrainerId(userId: string) {
  const p = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  return p?.id ?? null
}

export async function POST(req: Request) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const trainerId = await getTrainerId(session.user.id)
  if (!trainerId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })

  await Promise.all(
    parsed.data.ids.map((id, index) =>
      prisma.customField.updateMany({
        where: { id, trainerId },
        data: { order: index },
      })
    )
  )

  return NextResponse.json({ ok: true })
}
