import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({
  name: z.string().min(1),
  typeId: z.string().min(1),
})

export async function POST(req: Request) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const trainer = await prisma.trainerProfile.findUnique({ where: { id: session.user.trainerId ?? '' }, select: { id: true } })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  // Verify the type belongs to this trainer
  const type = await prisma.libraryType.findFirst({ where: { id: parsed.data.typeId, trainerId: trainer.id } })
  if (!type) return NextResponse.json({ error: 'Type not found' }, { status: 404 })

  const maxOrder = await prisma.libraryTheme.aggregate({ where: { typeId: type.id }, _max: { order: true } })
  const theme = await prisma.libraryTheme.create({
    data: { name: parsed.data.name, typeId: type.id, order: (maxOrder._max.order ?? -1) + 1 },
  })

  return NextResponse.json(theme, { status: 201 })
}
