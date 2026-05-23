import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { guardPermission } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ blackoutId: string }> }
) {
  const guard = await guardPermission('settings.edit')
  if (guard instanceof NextResponse) return guard
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  const trainerId = session.user.trainerId
  if (!trainerId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { blackoutId } = await params
  const found = await prisma.blackoutPeriod.findFirst({
    where: { id: blackoutId, trainerId },
  })
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.blackoutPeriod.delete({ where: { id: blackoutId } })
  return NextResponse.json({ ok: true })
}
