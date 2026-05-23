import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const schema = z.object({ name: z.string().min(1) })

async function getTheme(themeId: string, userId: string) {
  const trainer = await prisma.trainerProfile.findUnique({ where: { userId }, select: { id: true } })
  if (!trainer) return null
  return prisma.libraryTheme.findFirst({
    where: { id: themeId, type: { trainerId: trainer.id } },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ themeId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { themeId } = await params
  const theme = await getTheme(themeId, session.user.id)
  if (!theme) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const updated = await prisma.libraryTheme.update({ where: { id: themeId }, data: { name: parsed.data.name } })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ themeId: string }> }) {
  const guard = await guardPermission('forms.manage')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { themeId } = await params
  const theme = await getTheme(themeId, session.user.id)
  if (!theme) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.libraryTheme.delete({ where: { id: themeId } })
  return NextResponse.json({ ok: true })
}
